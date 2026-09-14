// Shared API types — mirror the backend DTOs.

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  errors?: unknown;
  timestamp: string;
}

export interface PageEnvelope<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  employeeCode: string;
  email?: string;
  phone?: string;
  aadhar?: string;
  industry?: string;
  photoPath?: string;
  companyName?: string;
  roles: string[];
  permissions: string[];

  // Read by the UI, NOT sent by LoginResponse.AuthUser on the server. Every use
  // is behind a truthiness check with a fallback, so they are optional here
  // rather than removed: declaring them keeps those branches compiling and keeps
  // this interface honest about what the code actually looks for. If the server
  // starts sending them, nothing here needs to change; if a branch is confirmed
  // dead, delete the branch and the field together.
  firstName?: string;
  lastName?: string;
  employeeId?: string;
  /** Tenant the account belongs to. Multi-tenant work in progress. */
  tenantId?: string;
  /** Same idea as tenantId; both spellings are looked for at the call sites. */
  companyId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface LoginResponse {
  user: AuthUser;
  tokens: TokenPair;
}

export interface AddressDto {
  careOf?: string;
  house?: string;
  street?: string;
  locality?: string;
  vtc?: string;
  district?: string;
  state?: string;
  country?: string;
  pincode?: string;
  postOffice?: string;
}

export interface Profile {
  id: number;
  employeeCode: string;
  username?: string;
  name: string;
  dob?: string;
  gender?: string;
  aadhar?: string;
  phone?: string;
  email?: string;
  photoPath?: string;
  address?: AddressDto;
  departmentId?: number;
  designationId?: number;
  officeLocationId?: number;
  reportingManagerId?: number;
  industry?: string;
  employmentType?: string;
  dateOfJoining?: string;
  profileStatus?: string;
  pan?: string;
  /** Provident fund account number. Optional. */
  pfNumber?: string;
  alternatePhone?: string;
  emergencyContact?: string;
  emergencyContactRelation?: string;
  bloodGroup?: string;
  personalEmail?: string;
  designationTitle?: string;
  departmentTitle?: string;
  positionTitle?: string;
  roles: string[];
  /** Comma-separated upload paths: the employee's own paperwork. */
  documents?: string;
  /**
   * The face enrolment, for HR to look at — the reason HR does the registering
   * is being able to confirm afterwards that it was the right person.
   */
  facePhotoPath?: string | null;
  faceRegisteredAt?: string | null;
  faceRegisteredByName?: string | null;
}

export interface BankResponse {
  id: number;
  bankName: string;
  branchName?: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName?: string;
  primary: boolean;
}

/**
 * One employee's service record, as returned by /users/history.
 *
 * Assembled server-side from the joining date, employment status, offboarding
 * record and audit log. Everything is optional except the identity, because a
 * record that has not reached a stage yet has nothing to show for it.
 */
export interface EmployeeHistoryRow {
  id: number;
  employeeCode: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  designationTitle: string | null;
  departmentName: string | null;
  roles: string[];
  dateOfJoining: string | null;
  probationEndDate: string | null;
  employmentStatus: string | null;
  profileStatus: string | null;
  relievingDate: string | null;
  relievingReason: string | null;
  fnfStatus: string | null;
  tenureMonths: number | null;
  events: EmployeeHistoryEvent[];
}

export interface EmployeeHistoryEvent {
  date: string;
  /** JOINED | PROBATION_END | CHANGE | RELIEVED */
  type: string;
  detail: string;
  actor: string | null;
}

export interface UserSummary {
  id: number;
  employeeCode: string;
  name: string;
  /** Login name. */
  username?: string;
  /**
   * The employee's current password, in the clear.
   *
   * The hash cannot be reversed, so a sealed copy is kept beside it purely so
   * HR can tell somebody what their password is. The server returns it only
   * to roles allowed to manage users, and it is null when no copy was ever
   * kept -- an account whose password was set before the vault existed.
   */
  password?: string | null;
  email?: string;
  phone?: string;
  industry?: string;
  departmentId?: number;
  departmentTitle?: string;
  departmentName?: string;
  profileStatus?: string;
  photoPath?: string;
  dob?: string;
  roles?: string[];
  designationId?: number;
  designationTitle?: string;
  techStack?: string;
  employmentType?: string;
  companyName?: string;
  companyId?: string;
  joiningDate?: string;
  createdAt?: string;
  /**
   * Whether this account turns up for work.
   *
   * False for desk logins -- the HR inbox, the company-admin account -- which
   * have nobody behind them to punch in. Computed on the server.
   */
  attends?: boolean;
}

export interface AttendanceRecord {
  id: number;
  userId: number;
  workDate: string;
  punchInAt?: string;
  punchOutAt?: string;
  mode: string;
  withinGeofence?: boolean;
  status: string;
  late: boolean;
  /** How many minutes after office start the punch-in was. */
  lateMinutes?: number;
  workedMinutes?: number;
  overtimeMinutes?: number;
  geofenceException?: boolean;
  inLatitude?: number;
  inLongitude?: number;
  outLatitude?: number;
  outLongitude?: number;

  /**
   * Where the punch was made, named — the office or site it falls inside, or
   * "Other location" with how far it was from the nearest one on record.
   * Coordinates are true and unreadable; this is the same numbers made legible.
   */
  inLocationName?: string | null;
  outLocationName?: string | null;
  inDistanceMetres?: number | null;
  inAccuracyMetres?: number | null;

  /** The face check, so a punch can be confirmed months later. */
  faceVerified?: boolean;
  facePhotoPath?: string | null;
  faceScore?: number | null;
  outFaceVerified?: boolean;
  outFacePhotoPath?: string | null;
  inDevice?: string | null;
  outDevice?: string | null;

  /**
   * How a biometric terminal authenticated the punch — FACE, FINGERPRINT or
   * FACE_FINGERPRINT. Absent for a punch made in the app.
   *
   * The distinction people actually ask about: a punch from the app is somebody
   * saying they arrived, a punch at the terminal is the terminal recognising
   * their face.
   */
  inAuthMethod?: string | null;
  outAuthMethod?: string | null;

  /**
   * The terminal area, as Hikvision names it — "Main Gate", "Second Floor
   * Entry".
   *
   * Separate from inLocationName, which is derived from GPS. A wall-mounted
   * terminal sends no coordinates, so that field is empty for these punches
   * however real the place is — this is the location for them, and a better
   * one: a named door rather than a point inside a radius.
   */
  inAreaName?: string | null;
  outAreaName?: string | null;
}

export interface LeaveType {
  id: number;
  name: string;
  code: string;
  maxDaysPerYear?: number;
  carryForward: boolean;
  encashable: boolean;
  genderRestriction?: string;
  allowPastDates: boolean;
  minNoticeDays?: number;
  monthlyLimit?: number;
  accrualType?: string;
  paid?: boolean;
  /** Whether the type is offered. False means it was switched off, not removed. */
  active?: boolean;
}

export interface LeaveBalance {
  leaveTypeId: number;
  leaveTypeName: string;
  leaveTypeCode: string;
  year: number;
  allocated: number;
  used: number;
  available: number;
}

export interface LeaveRequest {
  id: number;
  userId: number;
  employeeName: string;
  leaveTypeId: number;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  reason?: string;
  status: string;
  decidedBy?: number;
  decidedAt?: string;
  decisionComment?: string;
  createdAt: string;
  applicantRole?: string;
  canAct?: boolean;
  requestedToName?: string;
  decidedByName?: string;
  /** How their role reads — shown beside the name in the approvals table. */
  requestedToRole?: string;
  decidedByRole?: string;
  team?: string;
  employeeCode?: string;
}

export interface PayslipSummary {
  id: number;
  payMonth: number;
  payYear: number;
  grossSalary: number;
  netPay: number;
  pdfPath?: string;
  /*
   * Whether the payslip reached the employee.
   *
   * Optional so a cached response from before the field existed still type
   * checks; treat an absent value as NOT_SENT, which is what it means.
   */
  deliveryStatus?: "NOT_SENT" | "SENT" | "FAILED";
  sentTo?: string;
  sentAt?: string;
  sendError?: string;
}

export interface Payslip extends PayslipSummary {
  userId: number;
  employeeName: string;
  employeeCode: string;
  basicSalary: number;
  hra: number;
  allowances: number;
  overtimePay: number;
  pfDeduction: number;
  esiDeduction: number;
  ptDeduction: number;
  tdsDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  lopDays: number;
  generatedAt: string;
  // customizable fields (V15)
  companyName?: string;
  companyLogo?: string;
  companyGstin?: string;
  companyAddress?: string;
  bankName?: string;
  bankAccount?: string;
  designation?: string;
  department?: string;
  payDate?: string;
  workingDays?: number;
  conveyanceAllowance?: number;
  specialAllowance?: number;
  bonus?: number;
  otherEarnings?: number;
  leaveDeduction?: number;
  advanceDeduction?: number;
  performancePay?: number;
  expensesPay?: number;
  salaryAdvance?: number;
  healthInsurance?: number;
  source?: string;
}

export interface PayslipRequest {
  id: number;
  userId: number;
  employeeName: string;
  employeeCode: string;
  payMonth: number;
  payYear: number;
  note?: string;
  status: string; // PENDING | APPROVED | REJECTED
  payslipId?: number;
  decisionNote?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface WorkReport {
  id: number;
  userId: number;
  employeeName: string;
  employeeCode: string;
  workDate: string;
  projectName: string;
  workHours: number;
  taskDescription?: string;
  /** Comma-separated upload paths for files attached to this entry. */
  attachments?: string;
}

export interface EmployeeWorkList {
  userId: number;
  employeeName: string;
  employeeCode: string;
  totalRows: number;
  totalHours: number;
  rows: WorkReport[];
}

export interface TaskItem {
  id: number;
  title: string;
  description?: string;
  assignedTo: number;
  assigneeName?: string;
  assigneeCode?: string;
  assigneeIndustry?: string;
  assignedBy?: number;
  assignerName?: string;
  status: string; // PENDING | COMPLETED
  priority?: string; // LOW | MEDIUM | HIGH
  progress?: number; // 0-100
  dueDate?: string;
  createdAt?: string;
  completedAt?: string;
  teamBatchId?: string;
  teamName?: string;
}

export interface EmployeeTaskGroup {
  userId: number;
  employeeName: string;
  employeeCode: string;
  industry?: string;
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
  tasks: TaskItem[];
}

export interface Asset {
  id: number;
  assetCode: string;
  category: string;
  assetType?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  registrationNo?: string;
  /** When it was bought. */
  purchaseDate?: string;
  /** The date warranty cover runs out. */
  warrantyExpiry?: string;
  status: string;
  siteId?: number;
  assignedTo?: number;
  qrPath?: string;
  quantity?: number;
  createdAt?: string;
}

export interface TicketComment {
  id: number;
  authorId: number;
  authorName: string;
  comment: string;
  attachmentPath?: string;
  createdAt: string;
}

export interface Ticket {
  id: number;
  ticketCode: string;
  raisedBy: number;
  raisedByName: string;
  raisedByCode?: string;
  title: string;
  description?: string;
  /** Comma-separated upload paths — screenshots or documents from the raiser. */
  attachments?: string;
  type: string;
  category?: string;
  priority: string;
  status: string;
  assignedTo?: number;
  assignedToName?: string;
  slaDueAt?: string;
  rating?: number;
  resolvedAt?: string;
  createdAt: string;
  comments?: TicketComment[];
}

export interface AppNotification {
  id: number;
  title: string;
  body?: string;
  message?: string;
  type?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface EmployeeDashboard {
  employeeName: string;
  employeeCode: string;
  punchedInToday: boolean;
  punchInAt?: string;
  punchOutAt?: string;
  workedMinutesToday?: number;
  leaveBalances: LeaveBalance[];
  pendingLeaveRequests: number;
  myOpenTickets: number;
  myAssets: number;
  recentNotifications: AppNotification[];
}

export interface ExecutiveDashboard {
  headcount: number;
  presentToday: number;
  attendancePercentToday: number;
  pendingLeaveApprovals: number;
  openTickets: number;
  assetsAssigned: number;
  assetsInStock: number;
  departmentBreakdown: Record<string, number>;
  monthlyAttendanceTrend: any[];
  leaveUtilization: Record<string, number>;
  payrollCosts: any[];
}

export interface PayrollRunResponse {
  id: number;
  runMonth: number;
  runYear: number;
  status: string;
  totalEmployees: number;
  totalGross: number;
  totalNet: number;
  createdAt: string;
}

export interface HolidayResponse {
  id: number;
  name: string;
  holidayDate: string;
}

export interface ExpenseClaimResponse {
  id: number;
  userId: number;
  category: string;
  amount: number;
  claimDate: string;
  receiptPath?: string;
  managerStatus: string;
  financeStatus: string;
  createdAt: string;
}

export interface OnboardingTaskResponse {
  id: number;
  taskName: string;
  description?: string;
  isCompleted: boolean;
  completedAt?: string;
}

export interface OnboardingChecklistResponse {
  id: number;
  userId: number;
  status: string;
  startedAt: string;
  completedAt?: string;
  tasks: OnboardingTaskResponse[];
}

export interface PerformanceGoalResponse {
  id: number;
  userId: number;
  title: string;
  description?: string;
  progress: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceReviewResponse {
  id: number;
  userId: number;
  managerId: number;
  reviewPeriod: string;
  selfRating?: number;
  selfComment?: string;
  managerRating?: number;
  managerComment?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DropdownItem {
  id: number;
  label: string;
}

export interface ComplaintNeed {
  id: number;
  referenceCode: string;
  raisedBy: number;
  raisedByName: string;
  raisedByCode?: string;
  userId?: number;
  employeeName?: string;
  employeeCode?: string;
  team?: string;
  /** The HR this was addressed to; null means any HR may pick it up. */
  requestedTo?: number;
  requestedToName?: string;
  kind: string; // COMPLAINT | NEED
  category?: string;
  subject: string;
  description: string;
  priority: string; // LOW | MEDIUM | HIGH
  status: string; // OPEN | IN_REVIEW | RESOLVED | REJECTED
  targetRoleName?: string;
  resolutionNotes?: string;
  hrResponse?: string;
  handledBy?: number;
  handledByName?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SafetyIncident {
  id: number;
  referenceCode: string;
  reportedBy: number;
  reportedByName: string;
  incidentType: string;
  description: string;
  zone?: string;
  anonymous: boolean;
  severity: string;
  status: string;
  occurredAt?: string;
  resolutionNotes?: string;
  resolvedBy?: number;
  resolvedByName?: string;
  resolvedAt?: string;
  createdAt: string;
}

/**
 * One permission request — a sanctioned short absence, an hour or two rather
 * than a day.
 *
 * Lived in Permissions.tsx until the attendance report needed it too. Kept as
 * one definition rather than two, because the second copy is the one that
 * quietly loses a field when the server adds one.
 */
export interface PermissionRow {
  id: number;
  userId: number;
  employeeName: string;
  employeeCode: string;
  requestDate: string;
  fromTime: string;
  toTime: string;
  hours: number;
  reason?: string;
  /** HIGH | MEDIUM | LOW. */
  priority?: string;
  status: string;
  decisionComment?: string;
  createdAt?: string;
  requestedTo?: number;
  requestedToName?: string;
  decidedByName?: string;
  decidedAt?: string;
  team?: string;
}
