using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Root landing endpoint matching Spring Boot HomeController.java.
/// </summary>
[ApiController]
[AllowAnonymous]
public sealed class HomeController : ControllerBase
{
    [HttpGet("/")]
    public IActionResult Home() => Ok(new
    {
        app = "Pixous HR Portal API",
        status = "running",
        health = "/actuator/health",
        docs = "/swagger",
        note = "This is the API server. Open the web app URL to use the portal."
    });
}
