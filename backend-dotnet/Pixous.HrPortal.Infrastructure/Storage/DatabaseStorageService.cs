using Dapper;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Storage;

/// <summary>
/// Stores uploads in <c>system_files</c>, ported from
/// com.pixous.hrportal.common.StorageService.
///
/// Database rather than disk, which is the Java's choice and worth keeping: the
/// files move with the database, a second application instance sees the same
/// files without a shared volume, and the pre-deploy backup carries them.
///
/// The filesystem fallback on read is kept for rows written before that change.
/// It is read-only — nothing is ever written to disk here.
/// </summary>
public sealed class DatabaseStorageService : DalBase, IStorageService
{
    private readonly string _localRoot;

    public DatabaseStorageService(IDbConnectionFactory connectionFactory,
                                  Microsoft.Extensions.Options.IOptions<Configuration.AppOptions> options)
        : base(connectionFactory)
    {
        _localRoot = options.Value.Storage.LocalPath;
    }

    public async Task<string> StoreAsync(Stream content, string? originalFileName,
                                         string? contentType, long sizeBytes, string folder,
                                         CancellationToken ct = default)
    {
        if (sizeBytes <= 0)
        {
            throw ApiException.Business("File is empty");
        }

        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, ct);
        byte[] data = buffer.ToArray();

        if (data.Length == 0)
        {
            throw ApiException.Business("File is empty");
        }

        string relative = StoragePaths.BuildRelativePath(
            folder, originalFileName, DateOnly.FromDateTime(DateTime.Now));

        await InsertAsync(relative, originalFileName ?? "file", contentType, data, ct);
        return relative;
    }

    public async Task<string> StoreBytesAsync(byte[] content, string folder, string fileName,
                                              CancellationToken ct = default)
    {
        // A known name, not a GUID: these are generated artefacts a caller looks
        // up again by the name it chose.
        string relative = $"{folder}/{fileName}";
        await InsertAsync(relative, fileName, "application/octet-stream", content, ct);
        return relative;
    }

    /// <summary>
    /// Upsert rather than insert. The id is the relative path, and
    /// StoreBytesAsync can legitimately regenerate the same artefact — a payslip
    /// PDF reissued after a correction writes the same path, and a plain insert
    /// would fail on the primary key.
    /// </summary>
    private Task InsertAsync(string relative, string fileName, string? contentType,
                             byte[] data, CancellationToken ct) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO system_files (id, file_name, content_type, size_bytes, data, created_at)
            VALUES (@relative, @fileName, @contentType, @sizeBytes, @data, @createdAt)
            ON DUPLICATE KEY UPDATE
                file_name = VALUES(file_name),
                content_type = VALUES(content_type),
                size_bytes = VALUES(size_bytes),
                data = VALUES(data)
            """,
            new
            {
                relative,
                fileName,
                contentType,
                sizeBytes = (long)data.Length,
                data,
                createdAt = DateTime.Now
            }, cancellationToken: ct)), ct);

    public async Task<StoredFile> ReadAsync(string relativePath, CancellationToken ct = default)
    {
        // Refused here rather than in the caller, so the next caller inherits
        // the guarantee too.
        if (!StoragePaths.IsSafeRelativePath(relativePath))
        {
            throw ApiException.NotFound("File");
        }

        var row = await QueryAsync(conn =>
            conn.QueryFirstOrDefaultAsync<(string FileName, string? ContentType, byte[] Data)?>(
                new CommandDefinition(
                    "SELECT file_name, content_type, data FROM system_files WHERE id = @relativePath",
                    new { relativePath }, cancellationToken: ct)), ct);

        if (row is not null)
        {
            return new StoredFile(relativePath, row.Value.FileName, row.Value.ContentType,
                                  row.Value.Data);
        }

        // Fallback to the local filesystem for older files. Read-only.
        string full = Path.GetFullPath(Path.Combine(_localRoot, relativePath));
        string root = Path.GetFullPath(_localRoot);

        // Checked again after normalisation: IsSafeRelativePath rejects the
        // obvious forms, and this catches anything that still resolves outside
        // the root on this particular filesystem.
        if (full.StartsWith(root, StringComparison.Ordinal) && File.Exists(full))
        {
            byte[] data = await File.ReadAllBytesAsync(full, ct);
            return new StoredFile(relativePath, Path.GetFileName(full), null, data);
        }

        throw ApiException.NotFound("File");
    }
}
