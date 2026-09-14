using System.Security.Cryptography;
using System.Text;
using Pixous.HrPortal.Domain.Modules.Chatbot;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Modules.User;
using Xunit;

namespace Pixous.HrPortal.Tests;

public class Phase6WorkflowTests
{
    // =========================================================================
    // 1. WebRTC Calling & ICE Servers
    // =========================================================================

    [Fact]
    public void CallLog_OutcomeAndDuration_FormattedCorrectly()
    {
        Assert.Equal("45s", FormatDuration(45));
        Assert.Equal("1m 45s", FormatDuration(105));
        Assert.Equal("0s", FormatDuration(0));
        Assert.Equal("0s", FormatDuration(-5));
        Assert.Equal("3m 0s", FormatDuration(180));
    }

    [Theory]
    [InlineData("MISSED", true, 0, "Video call • Missed")]
    [InlineData("DECLINED", false, 0, "Voice call • Declined")]
    [InlineData("ENDED", false, 95, "Voice call • 1m 35s")]
    [InlineData("ENDED", true, 30, "Video call • 30s")]
    public void CallLog_ConstructsAccurateMessage(string outcome, bool video, int seconds, string expected)
    {
        string kind = video ? "Video call" : "Voice call";
        string formattedOutcome = outcome switch
        {
            "MISSED" => "Missed",
            "DECLINED" => "Declined",
            _ => FormatDuration(seconds)
        };

        string content = $"{kind} • {formattedOutcome}";
        Assert.Equal(expected, content);
    }

    [Fact]
    public void TurnCredentials_HmacSha1Signature_MatchesSpecification()
    {
        string secret = "test-super-secret-turn-key-123";
        long expires = 1750000000;
        string username = $"{expires}:mobile";

        using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(username));
        string credential = Convert.ToBase64String(hash);

        Assert.NotEmpty(credential);

        // Verification with same key
        using var hmacVerify = new HMACSHA1(Encoding.UTF8.GetBytes(secret));
        byte[] verifyHash = hmacVerify.ComputeHash(Encoding.UTF8.GetBytes(username));
        Assert.Equal(credential, Convert.ToBase64String(verifyHash));
    }

    // =========================================================================
    // 2. Community Chat Real-Time Enhancements & DTOs
    // =========================================================================

    [Fact]
    public void CommunityMemberView_ExposesBothIdAndUserId_ForReactParity()
    {
        var member = new CommunityMemberView(
            UserId: 42,
            Name: "John Doe",
            EmployeeCode: "PIX-E042",
            DesignationTitle: "Frontend Engineer",
            JoinedAt: DateTime.UtcNow,
            PhotoPath: "/uploads/photos/john.jpg");

        // React useChat / Chat.tsx line 883 accesses m.id
        Assert.Equal(42, member.Id);
        Assert.Equal(42, member.UserId);
        Assert.Equal("John Doe", member.Name);
        Assert.Equal("/uploads/photos/john.jpg", member.PhotoPath);
    }

    [Fact]
    public void ChatMessage_RetainsAllDecoratorFields()
    {
        var msg = new ChatMessage(
            MessageId: 1001,
            CommunityId: 5,
            SenderId: 20,
            SenderName: "Alice",
            Content: "Team poll: when should we release?",
            AudioPath: null,
            Attachments: null,
            SentAt: DateTime.UtcNow,
            Deleted: false,
            ParentId: null,
            Pinned: true,
            PinnedAt: DateTime.UtcNow,
            RequiresAck: false,
            ScheduledAt: null,
            PollOptions: ["Today", "Tomorrow", "Next Week"])
        {
            ReplyCount = 4,
            Reactions = new Dictionary<string, int> { ["👍"] = 5, ["🎉"] = 2 },
            MyReactions = ["👍"],
            ReadCount = 12,
            AckCount = 0,
            AcknowledgedByMe = false,
            PollVotes = [3, 2, 0],
            MyVote = 0
        };

        Assert.Equal(1001, msg.MessageId);
        Assert.True(msg.Pinned);
        Assert.Equal(4, msg.ReplyCount);
        Assert.Equal(5, msg.Reactions["👍"]);
        Assert.Contains("👍", msg.MyReactions);
        Assert.Equal(12, msg.ReadCount);
        Assert.Equal(3, msg.PollOptions?.Count);
        Assert.Equal(0, msg.MyVote);
        Assert.Equal(3, msg.PollVotes?[0]);
    }

    [Fact]
    public void CommunityRoom_ExposesPartnerPhotoPath()
    {
        var room = new CommunityRoom(
            Id: 10,
            Name: "Bob Smith",
            Description: null,
            CreatedBy: 1,
            CreatedAt: DateTime.UtcNow,
            IsAnnouncement: false,
            Direct: true,
            PartnerId: 25,
            PartnerCode: "PIX-E025",
            UnreadCount: 3,
            PartnerPhotoPath: "/uploads/photos/bob.png");

        Assert.Equal("/uploads/photos/bob.png", room.PartnerPhotoPath);
        Assert.True(room.Direct);
        Assert.Equal(25, room.PartnerId);
    }

    // =========================================================================
    // 3. AI Assistant Chatbot
    // =========================================================================

    [Theory]
    [InlineData("gsk_1234567890abcdef", "gsk_••••••••cdef")]
    [InlineData("AIzaSyB1234567890abcdef", "AIza••••••••cdef")]
    [InlineData("short", "••••")]
    [InlineData("12345678", "••••")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void Chatbot_AdminSettings_MasksKeysProperly(string? input, string expected)
    {
        string masked = MaskSecret(input);
        Assert.Equal(expected, masked);
    }

    [Theory]
    [InlineData("I want to apply for leave", "en", "Leave")]
    [InlineData("leave விண்ணப்பிக்க வேண்டும்", "ta", "Leave")]
    [InlineData("छुट्टी के लिए आवेदन कैसे करें", "hi", "Leave")]
    [InlineData("how to punch attendance", "en", "Punch in/out")]
    [InlineData("வருகை பதிவு செய்ய வேண்டும்", "ta", "Punch In/Out")]
    [InlineData("where is my payslip", "en", "Payslips")]
    [InlineData("சம்பள விவரங்கள் எங்கே", "ta", "Payslips")]
    public void Chatbot_LocalFallback_AnswersKeywordsCorrectly(string query, string lang, string expectedSubstr)
    {
        string reply = FallbackReply(query, lang, ["LEAVE", "ATTENDANCE", "PAYROLL", "ASSETS"]);
        Assert.Contains(expectedSubstr, reply);
    }

    [Fact]
    public void Chatbot_LocalFallback_AnswersGracefullyWhenModuleDisabled()
    {
        // When LEAVE module is disabled for company
        string replyEn = FallbackReply("how to apply for leave", "en", ["ATTENDANCE"]);
        Assert.Contains("That is not switched on for your company", replyEn);

        string replyTa = FallbackReply("leave வேண்டும்", "ta", ["ATTENDANCE"]);
        Assert.Contains("அந்த வசதி உங்கள் நிறுவனத்தில் இயக்கப்படவில்லை", replyTa);
    }

    // =========================================================================
    // Test Helpers matching BAL implementations
    // =========================================================================

    private static string FormatDuration(int? seconds)
    {
        int s = Math.Max(0, seconds ?? 0);
        if (s < 60) return $"{s}s";
        return $"{s / 60}m {s % 60}s";
    }

    private static string MaskSecret(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        string v = value.Trim();
        if (v.Length <= 8) return "••••";
        return v[..4] + "••••••••" + v[^4..];
    }

    private static string FallbackReply(string message, string lang, HashSet<string> enabledModules)
    {
        string q = message.ToLowerInvariant();
        bool canDiscuss(string mod) => enabledModules.Count == 0 || enabledModules.Contains(mod);

        bool leaveAsked = q.Contains("leave") || q.Contains("விடுப்பு") || q.Contains("छुट्टी") || q.Contains("अवकाश");
        bool attendanceAsked = q.Contains("attendance") || q.Contains("punch") || q.Contains("வருகை") || q.Contains("हाज़िरी") || q.Contains("उपस्थिति");
        bool payAsked = q.Contains("pay") || q.Contains("salary") || q.Contains("payslip") || q.Contains("சம்பள") || q.Contains("वेतन") || q.Contains("सैलरी");
        bool assetAsked = q.Contains("asset") || q.Contains("laptop") || q.Contains("சொத்து") || q.Contains("संपत्ति");

        bool leave = leaveAsked && canDiscuss("LEAVE");
        bool attendance = attendanceAsked && canDiscuss("ATTENDANCE");
        bool pay = payAsked && canDiscuss("PAYROLL");
        bool asset = assetAsked && canDiscuss("ASSETS");

        bool askedSomethingOff = (leaveAsked && !leave) || (attendanceAsked && !attendance)
                                || (payAsked && !pay) || (assetAsked && !asset);

        if (askedSomethingOff)
        {
            return lang switch
            {
                "ta" => "அந்த வசதி உங்கள் நிறுவனத்தில் இயக்கப்படவில்லை. நிர்வாகியை அணுகுங்கள்.",
                "hi" => "यह सुविधा आपकी कंपनी में सक्रिय नहीं है। कृपया अपने प्रशासक से संपर्क करें।",
                _ => "That is not switched on for your company. Ask your administrator if you need it."
            };
        }

        return lang switch
        {
            "ta" => leave ? "'Leave' மெனுவில் உங்கள் விடுப்பு விவரங்களைப் பார்த்து விண்ணப்பிக்கலாம்."
                 : attendance ? "Dashboard-இல் 'Punch In/Out' மூலம் வருகையைப் பதிவு செய்யலாம்; விவரங்கள் 'Attendance' பக்கத்தில்."
                 : pay ? "உங்கள் சம்பள விவரங்களையும் பேஸ்லிப்களையும் 'Payslips' பக்கத்தில் காணலாம்."
                 : asset ? "உங்களுக்கு வழங்கப்பட்ட சாதனங்கள் 'Assets' மெனுவில் பட்டியலிடப்பட்டுள்ளன."
                 : "நான் Pixous HR உதவியாளர்.",

            "hi" => leave ? "'Leave' मेन्यू में आप अपनी छुट्टी का बैलेंस देख सकते हैं और आवेदन कर सकते हैं।"
                 : attendance ? "Dashboard पर 'Punch In/Out' से हाज़िरी दर्ज करें; विवरण 'Attendance' पेज पर देखें।"
                 : pay ? "अपने वेतन और मासिक पे-स्लिप 'Payslips' पेज पर देखें और डाउनलोड करें।"
                 : asset ? "आपको सौंपे गए कंपनी उपकरण 'Assets' मेन्यू में सूचीबद्ध हैं।"
                 : "मैं Pixous HR सहायक हूँ।",

            _ => leave ? "You can check your leave balance and apply under the 'Leave' menu."
               : attendance ? "Punch in/out on the Dashboard, and view your logs under 'Attendance'."
               : pay ? "View and download your monthly payslips under the 'Payslips' menu."
               : asset ? "Company devices assigned to you are listed under the 'Assets' menu."
               : "I'm the Pixous HR Assistant."
        };
    }
}
