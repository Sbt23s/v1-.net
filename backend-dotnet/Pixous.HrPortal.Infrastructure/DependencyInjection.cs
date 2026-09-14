using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Configuration;
using Pixous.HrPortal.Domain.Modules.Attendance;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Announcement;
using Pixous.HrPortal.Domain.Modules.ApprovalConfig;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Modules.Dashboard;
using Pixous.HrPortal.Domain.Modules.Presence;
using Pixous.HrPortal.Domain.Modules.Calendar;
using Pixous.HrPortal.Domain.Modules.Onboarding;
using Pixous.HrPortal.Domain.Modules.Performance;
using Pixous.HrPortal.Domain.Modules.Safety;
using Pixous.HrPortal.Domain.Modules.TaskModule;
using Pixous.HrPortal.Domain.Modules.RequestThread;
using Pixous.HrPortal.Domain.Modules.Audit;
using Pixous.HrPortal.Domain.Modules.Appreciation;
using Pixous.HrPortal.Domain.Modules.Asset;
using Pixous.HrPortal.Domain.Modules.Complaint;
using Pixous.HrPortal.Domain.Modules.Discipline;
using Pixous.HrPortal.Domain.Modules.Expense;
using Pixous.HrPortal.Domain.Modules.Helpdesk;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Org;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Domain.Modules.WorkReport;
using Pixous.HrPortal.Domain.Modules.Wfh;
using Pixous.HrPortal.Domain.Modules.Auth;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Modules.Attendance;
using Pixous.HrPortal.Infrastructure.Modules.Admin;
using Pixous.HrPortal.Infrastructure.Modules.Announcement;
using Pixous.HrPortal.Infrastructure.Modules.ApprovalConfig;
using Pixous.HrPortal.Infrastructure.Modules.Community;
using Pixous.HrPortal.Infrastructure.Modules.Dashboard;
using Pixous.HrPortal.Infrastructure.Modules.Presence;
using Pixous.HrPortal.Infrastructure.Modules.Calendar;
using Pixous.HrPortal.Infrastructure.Modules.Onboarding;
using Pixous.HrPortal.Infrastructure.Modules.Performance;
using Pixous.HrPortal.Infrastructure.Modules.Safety;
using Pixous.HrPortal.Infrastructure.Modules.TaskModule;
using Pixous.HrPortal.Infrastructure.Modules.RequestThread;
using Pixous.HrPortal.Infrastructure.Modules.Audit;
using Pixous.HrPortal.Infrastructure.Modules.Appreciation;
using Pixous.HrPortal.Infrastructure.Modules.Asset;
using Pixous.HrPortal.Infrastructure.Modules.Complaint;
using Pixous.HrPortal.Infrastructure.Modules.Discipline;
using Pixous.HrPortal.Infrastructure.Modules.Expense;
using Pixous.HrPortal.Infrastructure.Modules.Helpdesk;
using Pixous.HrPortal.Infrastructure.Modules.Leave;
using Pixous.HrPortal.Infrastructure.Modules.Notification;
using Pixous.HrPortal.Infrastructure.Modules.Org;
using Pixous.HrPortal.Infrastructure.Modules.User;
using Pixous.HrPortal.Infrastructure.Modules.WorkReport;
using Pixous.HrPortal.Infrastructure.Modules.Wfh;
using Pixous.HrPortal.Infrastructure.Messaging;
using Pixous.HrPortal.Infrastructure.Realtime;
using Pixous.HrPortal.Infrastructure.Storage;
using Pixous.HrPortal.Infrastructure.Modules.Auth;
using Pixous.HrPortal.Infrastructure.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Persistence;
using Pixous.HrPortal.Infrastructure.Security;
using Pixous.HrPortal.Domain.Modules.Chatbot;
using Pixous.HrPortal.Infrastructure.Modules.Chatbot;
using Pixous.HrPortal.Domain.Modules.Biometric;
using Pixous.HrPortal.Infrastructure.Modules.Biometric;

namespace Pixous.HrPortal.Infrastructure;

/// <summary>
/// Registers everything the Infrastructure layer provides.
///
/// This is the equivalent of Spring's component scan, made explicit: the BAL
/// and DAL registrations for each module are added here as their modules are
/// ported, so the whole composition of the application is readable in one file
/// rather than spread across annotations.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Dapper cannot bind DateOnly/TimeOnly as parameters without these, and
        // every attendance query is keyed by work_date.
        DapperTypeHandlers.Register();

        services.AddOptions<AppOptions>()
                .Bind(configuration.GetSection(AppOptions.SectionName))
                .ValidateOnStart();

        // Singleton: it holds a connection string and hands out new connections,
        // with the pooling done by the driver underneath.
        services.AddSingleton<IDbConnectionFactory, MySqlConnectionFactory>();

        // Refuses to start against a schema this application is not allowed to
        // own. See SchemaSafetyGuard: no migration tooling, schema at or beyond
        // the version the DAL expects, and -- when configured read-only -- a
        // connection the SERVER confirms cannot write.
        services.AddSingleton<SchemaSafetyGuard>();

        // Singleton: the signing key is built once at construction, and the
        // class holds no per-request state.
        services.AddSingleton<IJwtService, JwtService>();

        // Singleton: stateless, and the work factor is a constant.
        services.AddSingleton<IPasswordHasher, BcryptPasswordHasher>();

        // Singleton: the AES key is derived once from the app secret.
        services.AddSingleton<IPasswordVault, PasswordVault>();

        // Scoped: reads the principal of the request being handled.
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUser>();

        services.AddHttpClient();

        AddModules(services);

        return services;
    }

    /// <summary>
    /// Per-module BAL and DAL registrations.
    ///
    /// Both are scoped, matching the lifetime a Spring @Service and @Repository
    /// effectively have per request: a DAL takes the connection factory and
    /// opens a connection per call, and a BAL may take the current user.
    /// </summary>
    private static void AddModules(IServiceCollection services)
    {
        // Auth
        services.AddScoped<IAuthDal, AuthDal>();
        services.AddScoped<IAuthBal, AuthBal>();

        // Attendance
        services.AddScoped<IAttendanceDal, AttendanceDal>();
        services.AddScoped<IOfficeLookupDal, OfficeLookupDal>();
        services.AddScoped<IAttendanceBal, AttendanceBal>();

        // File storage -- rows in system_files, not the filesystem.
        services.AddScoped<IStorageService, DatabaseStorageService>();

        // SMS. Singleton: it logs the chosen provider once at startup, which is
        // the point of logging it at all.
        services.AddSingleton<ISmsService, SmsService>();

        // Mail service for notifications and report attachments
        services.AddScoped<IMailService, Services.MailService>();

        // Realtime. A no-op until Phase 6 builds the STOMP endpoint; the call
        // sites in each module are written once and do not change when it lands.
        // Reads a token outside the authentication middleware -- the WebSocket
        // CONNECT frame needs it before that middleware has run.
        services.AddSingleton<Pixous.HrPortal.Domain.Security.IJwtReader, JwtReader>();

        // The realtime publisher is registered by the Api project, which owns the
        // STOMP transport (Phase 6). NoOpRealtimePublisher remains in this project
        // for tests and for any host that runs the modules without a socket.

        // Notification -- eighteen modules end by telling somebody.
        services.AddScoped<INotificationDal, NotificationDal>();
        services.AddScoped<INotificationBal, NotificationBal>();

        // User -- the employee directory; 26 modules depend on this module.
        services.AddScoped<IUserBal, UserBal>();

        // Complaint -- addressed-to routing; oversight answers anything.
        services.AddScoped<IComplaintDal, ComplaintDal>();
        services.AddScoped<IComplaintBal, ComplaintBal>();

        // Asset -- quantity-tracked; only the assignee acknowledges.
        services.AddScoped<IAssetDal, AssetDal>();
        services.AddScoped<IAssetBal, AssetBal>();

        // Appreciation -- a sent letter cannot be deleted.
        services.AddScoped<IAppreciationDal, AppreciationDal>();
        services.AddScoped<IAppreciationBal, AppreciationBal>();

        // Discipline -- HR raises, the CTO reviews.
        services.AddScoped<IDisciplineDal, DisciplineDal>();
        services.AddScoped<IDisciplineBal, DisciplineBal>();

        // Expense -- nobody decides their own claim.
        services.AddScoped<IExpenseDal, ExpenseDal>();
        services.AddScoped<IExpenseBal, ExpenseBal>();

        // Helpdesk -- separation of duty: the raiser does not decide it.
        services.AddScoped<IHelpdeskDal, HelpdeskDal>();
        services.AddScoped<IHelpdeskBal, HelpdeskBal>();

        // Permission -- short time off inside a working day; seven checks.
        services.AddScoped<IPermissionDal, PermissionDal>();
        services.AddScoped<IPermissionBal, PermissionBal>();

        // Leave -- eleven ordered checks on apply; see LeaveBal.
        services.AddScoped<ILeaveDal, LeaveDal>();
        services.AddScoped<ILeaveBal, LeaveBal>();

        // Work reports -- only the author may edit their own.
        services.AddScoped<IWorkReportDal, WorkReportDal>();
        services.AddScoped<IWorkReportBal, WorkReportBal>();

        // WFH -- six checks on apply, and the approver chain resolved server-side.
        services.AddScoped<IWfhDal, WfhDal>();
        services.AddScoped<IWfhBal, WfhBal>();

        // Org -- master data and the dropdowns every form reads.
        services.AddScoped<IOrgBal, OrgBal>();

        // Admin: the technical-admin realm and the data reset.
        services.AddScoped<ITechnicalAdminDal, TechnicalAdminDal>();
        services.AddScoped<IDataResetBal, DataResetBal>();
        services.AddScoped<ITechnicalAdminCompanyBal, TechnicalAdminCompanyBal>();
        services.AddScoped<ITechnicalAdminModuleBal, TechnicalAdminModuleBal>();
        services.AddScoped<ITechnicalAdminAuditBal, TechnicalAdminAuditBal>();
        services.AddScoped<ITechnicalAdminRoleBal, TechnicalAdminRoleBal>();

        // The sign-in announcement. Read by everyone, written by the
        // technical administrator only.
        services.AddScoped<IAnnouncementDal, AnnouncementDal>();
        services.AddScoped<IAnnouncementBal, AnnouncementBal>();

        // Approval configuration: who each module may address, and which Leave
        // tabs a role sees. Consulted by the other modules to NARROW their
        // dropdowns -- absent configuration leaves them exactly as they were.
        services.AddScoped<IApprovalConfigDal, ApprovalConfigDal>();
        services.AddScoped<IApprovalConfigBal, ApprovalConfigBal>();

        // The dashboards -- read-only aggregation over records the other
        // modules already keep.
        services.AddScoped<IDashboardDal, DashboardDal>();
        services.AddScoped<IDashboardBal, DashboardBal>();

        // Attachments and conversation on a leave or permission request.
        // Access is by relationship rather than permission, decided in the BAL.
        services.AddScoped<IRequestThreadDal, RequestThreadDal>();
        services.AddScoped<IRequestThreadBal, RequestThreadBal>();

        // Presence. The registry is a SINGLETON because it is the live state
        // of the process -- a scoped one would forget everybody between
        // requests and report nobody online.
        services.AddSingleton<IPresenceRegistry, PresenceRegistry>();
        services.AddScoped<IPresenceDal, PresenceDal>();
        services.AddScoped<IPresenceBal, PresenceBal>();

        // Communities: group chat, team rooms, private 1:1 and the announcement
        // channel. Access depends on the room, so it is decided in the BAL.
        services.AddScoped<ICommunityDal, CommunityDal>();
        services.AddScoped<ICommunityBal, CommunityBal>();

        // Tasks: assigning, working, and the conversation on each one.
        services.AddScoped<ITaskDal, TaskDal>();
        services.AddScoped<ITaskBal, TaskBal>();

        // Safety incidents. Anyone reports; REPORT_VIEW investigates.
        services.AddScoped<ISafetyDal, SafetyDal>();
        services.AddScoped<ISafetyBal, SafetyBal>();

        // The company calendar. Birthdays and anniversaries are derived, not
        // stored; holidays stay in their own module on purpose.
        services.AddScoped<ICalendarDal, CalendarDal>();
        services.AddScoped<ICalendarBal, CalendarBal>();

        // Performance goals and review cycles.
        services.AddScoped<IPerformanceDal, PerformanceDal>();
        services.AddScoped<IPerformanceBal, PerformanceBal>();

        // The joining checklist.
        services.AddScoped<IOnboardingDal, OnboardingDal>();
        services.AddScoped<IOnboardingBal, OnboardingBal>();

        // The copy to whoever oversees the whole portal. Keyed on the ACCOUNT
        // rather than a permission: HR holds USER_MANAGE, and a check on that
        // let HR read what was deliberately addressed past them.
        services.AddScoped<IOversightNotifier, OversightNotifier>();

        // Audit reads -- the other half of IAuditService, which writes.
        services.AddScoped<IAuditReadDal, AuditReadDal>();
        services.AddScoped<IAuditBal, AuditBal>();

        // Audit -- written by payroll and, later, by the user and leave modules.
        services.AddScoped<IAuditService, AuditService>();

        // Payroll & Reports
        services.AddScoped<IPayrollDal, PayrollDal>();
        services.AddScoped<IPayrollBal, PayrollBal>();
        services.AddScoped<IReportDal, ReportDal>();
        services.AddScoped<IReportBal, ReportBal>();

        // Calls (WebRTC signaling)
        services.AddScoped<ICallBal, CallBal>();

        // AI Assistant Chatbot
        services.AddScoped<IChatbotDal, ChatbotDal>();
        services.AddScoped<IChatbotBal, ChatbotBal>();

        // Biometric (Hikvision)
        services.AddScoped<IBiometricDal, BiometricDal>();
        services.AddScoped<IBiometricBal, BiometricBal>();
    }
}
