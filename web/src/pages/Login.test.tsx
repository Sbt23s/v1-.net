import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "./Login";

const { loginMock, navigateMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  navigateMock: vi.fn()
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ login: loginMock })
}));

// Keep the real Router exports but stub navigation so we can assert where the
// page redirects after a successful sign-in.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ state: null })
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    localStorage.clear();
    loginMock.mockReset();
    navigateMock.mockReset();
  });

  it("renders the sign-in form", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("username or full name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows validation errors when submitting empty fields", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Username is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("calls login and navigates home on valid credentials", async () => {
    loginMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("username or full name"), "admin");
    await user.type(screen.getByPlaceholderText("••••••••"), "Test1234@");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("admin", "Test1234@"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("does not navigate when login fails, and keeps the form usable", async () => {
    loginMock.mockRejectedValue(new Error("bad credentials"));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText("username or full name"), "admin");
    await user.type(screen.getByPlaceholderText("••••••••"), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(loginMock).toHaveBeenCalled());
    await waitFor(() => expect(navigateMock).not.toHaveBeenCalled());
    // The form still lets the user retry.
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    renderPage();

    const passwordInput = screen.getByPlaceholderText("••••••••");
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByPlaceholderText("••••••••")).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByPlaceholderText("••••••••")).toHaveAttribute("type", "password");
  });
});
