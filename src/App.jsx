import { useCallback, useEffect, useState } from "react";

import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8080/api",
});
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("einvoice-token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (
      body &&
      typeof body === "object" &&
      body.success === true &&
      "data" in body
    ) {
      response.data = body.data;
    }
    return response;
  },
  (error) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes("/auth/login")
    ) {
      localStorage.removeItem("einvoice-token");
      localStorage.removeItem("einvoice-user");
      window.dispatchEvent(new Event("einvoice-session-expired"));
    }
    return Promise.reject(error);
  },
);
const money = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
const date = (v) =>
  v
    ? new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const initialForm = () => ({
  invoiceNumber: "",
  issuedDt: new Date().toISOString().slice(0, 10),
  dueDt: "",
  items: [{ itemName: "", unitPrice: "", quantity: 1, remarks: "" }],
});
const statusLabel = (s) =>
  ({
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    APPROVED_LV1: "Awaiting Level 2",
    APPROVED_LV2: "Approved",
    REJECTED: "Rejected",
    RETURNED_TO_ADMIN: "Returned",
    ARCHIVED: "Archived",
    OVERDUE: "Overdue",
  })[s] || s;

function displayedInvoiceStatus(invoice) {
  if (invoice.archived) return "ARCHIVED";
  const workflowStatus = invoice.invoiceStatus;
  const activeStatuses = ["SUBMITTED", "APPROVED_LV1", "APPROVED_LV2"];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return activeStatuses.includes(workflowStatus) && invoice.dueDt?.slice(0, 10) < today
    ? "OVERDUE"
    : workflowStatus;
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("einvoice-user"));
    } catch {
      return null;
    }
  });
  const [page, setPage] = useState("dashboard");
  const [invoices, setInvoices] = useState([]);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [audit, setAudit] = useState([]);
  const [auditDetailEntry, setAuditDetailEntry] = useState(null);
  const [detailReturnPage, setDetailReturnPage] = useState("invoices");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);
  const [userEditor, setUserEditor] = useState(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [login, setLogin] = useState({ username: "", password: "" });

  const isAdmin = user?.userRole === "ADMIN";
  const isApprover = user?.userRole?.startsWith("APPROVER_");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      if (user.userRole === "ADMIN") {
        const [invoiceResponse, userResponse] = await Promise.all([
          api.get("/invoices"),
          api.get("/users"),
        ]);
        setInvoices(invoiceResponse.data);
        setUsers(userResponse.data);
      } else if (user.userRole?.startsWith("APPROVER_")) {
        const response = await api.get("/approvals/pending");
        setInvoices(response.data);
      }
    } catch (e) {
      setError(e.response?.data?.message || "Could not load the latest data.");
    }
  }, [user]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!user?.userId) return undefined;
    let cancelled = false;
    api.get("/auth/profile").then(({ data }) => {
      if (cancelled) return;
      setUser(data);
      localStorage.setItem("einvoice-user", JSON.stringify(data));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.userId]);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", login);
      localStorage.setItem("einvoice-token", data.token);
      localStorage.setItem("einvoice-user", JSON.stringify(data.user));
      setUser(data.user);
      setLogin({ username: "", password: "" });
      setPage("dashboard");
    } catch (e) {
      setError(
        e.response?.data?.message || "Username or password is incorrect.",
      );
    } finally {
      setBusy(false);
    }
  }
  const signOut = useCallback(() => {
    const token = localStorage.getItem("einvoice-token");
    if (token) {
      void api.post("/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    localStorage.removeItem("einvoice-token");
    localStorage.removeItem("einvoice-user");
    setLogin({ username: "", password: "" });
    setUser(null);
    setInvoices([]);
    setUsers([]);
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    let timer;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(signOut, 15 * 60 * 1000);
    };
    ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"].forEach((event) =>
      window.addEventListener(event, reset, { passive: true }),
    );
    reset();
    return () => {
      window.clearTimeout(timer);
      ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"].forEach((event) =>
        window.removeEventListener(event, reset),
      );
    };
  }, [user, signOut]);
  useEffect(() => {
    window.addEventListener("einvoice-session-expired", signOut);
    return () =>
      window.removeEventListener("einvoice-session-expired", signOut);
  }, [signOut]);
  useEffect(() => {
    const open = async () => {
      setPage("audit");
      try { const { data } = await api.get("/audit-trail"); setAudit(data); }
      catch (e) { setError(e.response?.data?.message || "Could not load audit history."); }
    };
    window.addEventListener("open-global-audit", open);
    return () => window.removeEventListener("open-global-audit", open);
  }, []);
  function flash(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }
  async function refresh() {
    await load();
  }
  async function openAudit(invoice) {
    setSelected(invoice);
    setDetailReturnPage(page === "dashboard" ? "dashboard" : "invoices");
    setPage("detail");
    setError("");
    if (!isAdmin) {
      setAudit([]);
      return;
    }
    try {
      const { data } = await api.get(
        `/invoices/${invoice.invoiceId}/trail`,
      );
      setAudit(data);
    } catch (e) {
      setError(e.response?.data?.message || "Could not load audit history.");
    }
  }
  async function submitEditor(event) {
    event.preventDefault();
    const submitIntent = event.nativeEvent.submitter?.value === "submit";
    const payload = {
      ...editor.form,
      items: editor.form.items.map((i) => ({
        ...i,
        unitPrice: Number(i.unitPrice),
        quantity: Number(i.quantity),
      })),
    };
    if (submitIntent) {
      setPendingReview({ editor, payload });
      setPage("confirm");
      return;
    }
    await persistInvoice(editor, payload, false);
  }
  async function persistInvoice(draft, payload, submitIntent) {
    setBusy(true);
    setError("");
    try {
      let response;
      if (submitIntent && !draft.id) {
        response = await api.post("/invoices/submit", payload);
      } else if (draft.id) response = await api.put(`/invoices/${draft.id}`, payload);
      else response = await api.post("/invoices", payload);
      let invoice = response.data;
      if (submitIntent && draft.id) {
        const submitted = await api.post(`/invoices/${invoice.invoiceId}/submit`);
        invoice = submitted.data;
      }
      setEditor(null);
      await refresh();
      setSelected(invoice);
      setDetailReturnPage("dashboard");
      setPage(draft.id ? "detail" : "acknowledgement");
      setPendingReview(null);
      flash(submitIntent ? "Invoice submitted for approval." : draft.id ? "Invoice updated." : "Draft invoice created.");
    } catch (e) {
      setError(e.response?.data?.message || "Could not save invoice.");
    } finally {
      setBusy(false);
    }
  }
  async function action(path, success) {
    setBusy(true);
    setError("");
    try {
      await api.post(path);
      await refresh();
      flash(success);
    } catch (e) {
      setError(e.response?.data?.message || "Action could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  async function decide(invoice, decision) {
    if (decision !== "approve" && !decisionNote.trim()) {
      setError("Add a reason before rejecting or returning an invoice.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.put(`/approvals/${invoice.invoiceId}/${decision}`, {
        remarks: decisionNote,
      });
      setDecisionNote("");
      await refresh();
      const successMessage = decision === "approve" && user.userRole === "APPROVER_LV1"
        ? "Sent for Level 2 approval."
        : `Invoice ${{ approve: "approved", reject: "rejected", return: "returned for revision" }[decision]}.`;
      flash(successMessage);
    } catch (e) {
      setError(e.response?.data?.message || "Decision could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function removeInvoice(invoice) {
    setConfirmDialog({ title: "Archive invoice?", message: `Archive draft ${invoice.invoiceNumber}?`, onConfirm: async () => {
    try {
      await api.delete(`/invoices/${invoice.invoiceId}`);
      await refresh();
      flash("Draft archived.");
    } catch (e) {
      setError(e.response?.data?.message || "Could not archive invoice.");
    }
    } });
  }
  async function saveUser(event) {
    event.preventDefault();
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    if (!payload.password) delete payload.password;
    try {
      if (userEditor) {
        const { data } = await api.put(`/users/${userEditor.userId}`, payload);
        if (String(userEditor.userId) === String(user.userId)) {
          setUser(data);
          localStorage.setItem("einvoice-user", JSON.stringify(data));
        }
      }
      else await api.post("/users", payload);
      formElement.reset();
      setUserEditor(null);
      await refresh();
      flash(userEditor ? "Account updated." : "User created.");
    } catch (e) {
      setError(e.response?.data?.message || "Could not save account.");
    } finally {
      setBusy(false);
    }
  }

  const totalAmount = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.totalAmount || 0),
    0,
  );

  if (!user)
    return (
      <Login
        login={login}
        setLogin={setLogin}
        signIn={signIn}
        busy={busy}
        error={error}
      />
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            setPage("dashboard");
          }}
        >
          <span className="brand-mark">E</span>
          <span>
            e-invoice
            <small>INVOICE WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list">
          <NavItem
            icon="◫"
            active={page === "dashboard"}
            onClick={() => setPage("dashboard")}
          >
            Overview
          </NavItem>
          {isAdmin && (
            <NavItem
              icon="＋"
              active={page === "invoices" || page === "editor"}
              onClick={() => {
                setEditor({ form: initialForm() });
                setPage("invoices");
              }}
            >
              Create Invoice
            </NavItem>
          )}
          {isAdmin && <NavItem icon="◷" active={page === "audit"} onClick={async () => {
            setPage("audit"); setSelected(null); setError("");
            try { const { data } = await api.get("/audit-trail"); setAudit(data); }
            catch (e) { setError(e.response?.data?.message || "Could not load audit history."); }
          }}>Audit trail</NavItem>}
          {isApprover && (
            <NavItem
              icon="✓"
              active={page === "approvals"}
              onClick={() => setPage("approvals")}
            >
              My approvals <span className="nav-count">{invoices.length}</span>
            </NavItem>
          )}
          {isAdmin && (
            <NavItem
              icon="♙"
              active={page === "users"}
              onClick={() => setPage("users")}
            >
              Team & access
            </NavItem>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">
              {user.firstName?.[0] || user.username[0]}
            </div>
            <div className="profile-copy">
              <b>
                {user.firstName} {user.lastName || ""}
              </b>
              <span>{user.userRole.replaceAll("_", " ")}</span>
              <button className="profile-password-button" onClick={() => setPasswordDialogOpen(true)}>
                Change password
              </button>
            </div>
            <button className="icon-button" title="Sign out" onClick={signOut}>
              ↪
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <b>
              {page === "invoices"
                ? "Create Invoice"
                : page === "editor"
                ? editor?.id
                  ? "Edit invoice"
                  : "New invoice"
                : page === "audit"
                  ? "Audit trail"
                  : page[0].toUpperCase() + page.slice(1)}
            </b>
          </div>
          <div className="topbar-right">
            <span className="secure-dot" /> Secure workspace{" "}
            <span className="top-divider" />{" "}
            <span className="top-date">
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </header>
        <div className="content-area">
          {error && (
            <div className="alert alert-error">
              <span>!</span>
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success">
              <span>✓</span>
              {notice}
            </div>
          )}
          {page === "dashboard" && (
            <Dashboard
              user={user}
              invoices={invoices}
              totalAmount={totalAmount}
              setPage={setPage}
              createInvoice={() => { setEditor({ form: initialForm() }); setPage("invoices"); }}
              openAudit={openAudit}
              actions={isAdmin ? {
                edit: (invoice) => { setEditor({ id: invoice.invoiceId, returnPage: "dashboard", original: invoice, form: { invoiceNumber: invoice.invoiceNumber, issuedDt: invoice.issuedDt, dueDt: invoice.dueDt, items: invoice.items.map(({ itemName, unitPrice, quantity, remarks }) => ({ itemName, unitPrice, quantity, remarks: remarks || "" })) } }); setPage("editor"); },
                submit: (invoice) => action(`/invoices/${invoice.invoiceId}/submit`, "Invoice sent for approval."),
                remove: removeInvoice,
              } : null}
            />
          )}
          {(page === "editor" || page === "invoices") && (
            <InvoiceEditor
              editor={editor}
              setEditor={setEditor}
              onSubmit={submitEditor}
              onBack={editor?.returnPage === "dashboard" ? () => { setEditor(null); setPage("dashboard"); } : null}
              busy={busy}
            />
          )}
          {page === "confirm" && pendingReview && <InvoiceConfirm editor={pendingReview.editor} payload={pendingReview.payload} busy={busy} back={() => setPage("editor")} confirm={() => persistInvoice(pendingReview.editor, pendingReview.payload, true)} />}
          {page === "approvals" && (
            <ApprovalList
              invoices={invoices}
              note={decisionNote}
              setNote={setDecisionNote}
              decide={decide}
              busy={busy}
            />
          )}
          {page === "audit" && (
            <AuditPage
              audit={audit}
              onShowDetails={setAuditDetailEntry}
            />
          )}
          {(page === "detail" || page === "acknowledgement") && <InvoiceDetail invoice={selected} acknowledgement={page === "acknowledgement"} canViewTrail={isAdmin} back={() => setPage(detailReturnPage)} done={() => { setEditor({ form: initialForm() }); setPage("invoices"); }} openTrail={async () => { setPage("invoice-trail"); try { const { data } = await api.get(`/invoices/${selected.invoiceId}/trail`); setAudit(data); } catch (e) { setError(e.response?.data?.message || "Could not load invoice trail."); } }} />}
          {page === "invoice-trail" && <InvoiceTrailPage invoice={selected} audit={audit} back={() => setPage("detail")} />}
          {page === "users" && (
            <UsersPage
              users={users}
              saveUser={saveUser}
              busy={busy}
              editor={userEditor}
              setEditor={setUserEditor}
              currentUserId={user.userId}
              removeUser={async (member) => {
                setConfirmDialog({ title: "Delete member?", message: `Are you sure you want to delete ${member.username}?`, onConfirm: async () => {
                try {
                  await api.delete(`/users/${member.userId}`);
                  await refresh();
                  flash("Account deleted.");
                } catch (e) {
                  setError(
                    e.response?.data?.message || "Could not delete account.",
                  );
                }
                } });
              }}
              isEditingOther={Boolean(userEditor && String(userEditor.userId) !== String(user.userId))}
            />
          )}
          {confirmDialog && <ConfirmDialog {...confirmDialog} close={() => setConfirmDialog(null)} confirm={async () => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); await fn(); }} />}
          {auditDetailEntry && <AuditDetailDialog entry={auditDetailEntry} close={() => setAuditDetailEntry(null)} />}
          {passwordDialogOpen && <PasswordChangeDialog close={() => setPasswordDialogOpen(false)} onDone={() => flash("Password changed successfully.")} />}
        </div>
      </main>
    </div>
  );
}

function Login({ login, setLogin, signIn, busy, error }) {
  return (
    <div className="login-layout">
      <div className="login-art">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-content">
          <a className="brand brand-light">
            <span className="brand-mark">E</span>
            <span>e-invoice</span>
          </a>
          <div className="art-copy">
            <h1>Electronic Invoice</h1>
          </div>
        </div>
      </div>
      <div className="login-panel">
        <form className="login-form" onSubmit={signIn}>
          <div className="mobile-brand">
            <span className="brand-mark">E</span> e-invoice
          </div>
          <h2>Sign in to your workspace</h2>
          <p className="muted">Enter your account details to continue.</p>
          {error && <div className="alert alert-error">{error}</div>}
          <label>
            Username
            <input
              autoComplete="username"
              value={login.username}
              onChange={(e) => setLogin({ ...login, username: e.target.value })}
              placeholder="Enter username"
              required
            />
          </label>
          <label>
            Password
            <PasswordInput
              autoComplete="current-password"
              value={login.password}
              onChange={(e) => setLogin({ ...login, password: e.target.value })}
              placeholder="Enter password"
              required
            />
          </label>
          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="login-foot">
            <span className="secure-dot" /> Your connection is encrypted
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input-wrap"><input {...props} type={visible ? "text" : "password"} /><button type="button" className="password-visibility" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.2 12s3.4-6 9.8-6 9.8 6 9.8 6-3.4 6-9.8 6-9.8-6-9.8-6Z"/><circle cx="12" cy="12" r="2.7"/></svg></button></span>;
}

function NavItem({ icon, active, onClick, children }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      {children}
    </button>
  );
}
function Dashboard({ user, invoices, totalAmount, setPage, createInvoice, openAudit, actions }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  const filteredInvoices = statusFilter
    ? invoices.filter((invoice) => displayedInvoiceStatus(invoice) === statusFilter)
    : invoices;
  const invoicePageCount = Math.max(1, Math.ceil(filteredInvoices.length / 10));
  const currentInvoicePage = Math.min(invoicePage, invoicePageCount);
  const visibleInvoices = filteredInvoices.slice((currentInvoicePage - 1) * 10, currentInvoicePage * 10);
  const approved = invoices.filter(
    (i) => i.invoiceStatus === "APPROVED_LV2",
  ).length;
  const pending = invoices.filter((i) =>
    ["SUBMITTED", "APPROVED_LV1"].includes(i.invoiceStatus),
  ).length;
  const drafts = invoices.filter((i) => i.invoiceStatus === "DRAFT").length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Hello, {user.firstName}.</h1>
          <p>Here’s what’s happening with your invoices today.</p>
        </div>
        {user.userRole === "ADMIN" && (
          <button
            className="button button-primary"
            onClick={createInvoice}
          >
            ＋ Create invoice
          </button>
        )}
      </div>
      <section className="stat-grid">
        <StatCard
          label="Total invoices"
          value={invoices.length}
          detail={
            user.userRole === "ADMIN"
              ? "Across all statuses"
              : "Assigned to you"
          }
          icon="▤"
          tone="blue"
        />
        <StatCard
          label="Awaiting approval"
          value={pending}
          detail="Moving through workflow"
          icon="◷"
          tone="amber"
        />
        <StatCard
          label="Fully approved"
          value={approved}
          detail="Ready for processing"
          icon="✓"
          tone="green"
        />
        <StatCard
          label={user.userRole === "ADMIN" ? "Drafts" : "Invoice value"}
          value={user.userRole === "ADMIN" ? drafts : money(totalAmount)}
          detail={
            user.userRole === "ADMIN"
              ? "Not yet submitted"
              : "Assigned invoices"
          }
          icon="◈"
          tone="purple"
        />
      </section>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {user.userRole === "ADMIN"
                ? "All invoices"
                : "Waiting for your decision"}
            </h2>
            <p>
              {user.userRole === "ADMIN"
                ? "Browse every invoice and open a record for its details."
                : "Your current approval queue."}
            </p>
          </div>
          <div className="overview-controls">
            <label className="status-filter">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setInvoicePage(1); }}>
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="APPROVED_LV1">Awaiting Level 2</option>
                <option value="APPROVED_LV2">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="RETURNED_TO_ADMIN">Returned</option>
                <option value="ARCHIVED">Archived</option>
                <option value="OVERDUE">Overdue</option>
              </select>
            </label>
            {user.userRole !== "ADMIN" && <button
              className="text-button"
              onClick={() => setPage("approvals")}
            >
              View all
            </button>}
          </div>
        </div>
        {filteredInvoices.length === 0 ? (
          <EmptyState
            title={invoices.length === 0 ? "All clear" : "No matching invoices"}
            detail={invoices.length === 0 ? "There are no invoices to show here yet." : "Try selecting a different status."}
          />
        ) : (
          <>
            <InvoiceTable invoices={visibleInvoices} audit={user.userRole === "ADMIN" ? openAudit : null} openDetail={openAudit} actions={actions} compact />
            <Pagination page={currentInvoicePage} totalItems={filteredInvoices.length} onPageChange={setInvoicePage} />
          </>
        )}
      </section>
    </>
  );
}
function Pagination({ page, totalItems, onPageChange }) {
  const pageCount = Math.max(1, Math.ceil(totalItems / 10));
  if (totalItems <= 10) return null;
  const pages = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : page <= 3
      ? [1, 2, 3, 4, 5, "right-gap", pageCount]
      : page >= pageCount - 2
        ? [1, "left-gap", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
        : [1, "left-gap", page - 1, page, page + 1, "right-gap", pageCount];
  const slotDesktop = pages.length * 24 + pages.length - 1;
  const slotMobile = pages.length * 22 + pages.length - 1;
  return <nav className="pagination" aria-label="Pagination" style={{ "--page-slot-desktop": `${slotDesktop}px`, "--page-slot-mobile": `${slotMobile}px` }}>
    <span>Page {page} of {pageCount}</span>
    <div>
      <button className="button button-quiet" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
      <div className="pagination-pages">{pages.map((value) => typeof value === "number"
        ? <button key={value} className={`page-number${value === page ? " active" : ""}`} aria-current={value === page ? "page" : undefined} onClick={() => onPageChange(value)}>{value}</button>
        : <span className="page-ellipsis" key={value}>…</span>)}</div>
      <button className="button button-quiet" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  </nav>;
}
function StatCard({ label, value, detail, icon, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function InvoiceTable({ invoices, audit, actions, openDetail, compact }) {
  return (
    <div className="table-wrap">
      <table className={compact ? "invoice-overview-table" : undefined}>
        {compact && <colgroup><col className="overview-col-invoice" /><col className="overview-col-date" /><col className="overview-col-date" /><col className="overview-col-amount" /><col className="overview-col-status" /><col className="overview-col-actions" /></colgroup>}
        <thead>
          <tr>
            <th>INVOICE</th>
            <th>ISSUED</th>
            <th>DUE DATE</th>
            <th>AMOUNT</th>
            <th>STATUS</th>
            <th>{actions ? "ACTIONS" : audit ? "HISTORY" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.invoiceId}>
              <td>
                {openDetail || audit ? (
                  <button className="invoice-link" onClick={() => (openDetail || audit)(i)}>
                    {i.invoiceNumber}
                  </button>
                ) : (
                  <span className="invoice-link">{i.invoiceNumber}</span>
                )}
                <small className="cell-sub">
                  {i.items?.length || 0} line items
                </small>
              </td>
              <td>{date(i.issuedDt)}</td>
              <td>{date(i.dueDt)}</td>
              <td className="amount-cell">{money(i.totalAmount)}</td>
              <td>
                <Status status={displayedInvoiceStatus(i)} />
              </td>
              <td>
                <div className="row-actions">
                  {actions &&
                    !i.archived &&
                    ["DRAFT", "RETURNED_TO_ADMIN"].includes(
                      i.invoiceStatus,
                    ) && (
                      <>
                        {i.invoiceStatus === "RETURNED_TO_ADMIN" ? <button className="small-action" onClick={() => actions.edit(i)}>Review</button> : <><button className="small-action" onClick={() => actions.edit(i)}>Edit</button><button className="small-action" onClick={() => actions.submit(i)}>Submit</button></>}
                        {i.invoiceStatus === "DRAFT" && (
                          <button
                            className="small-action danger-text"
                            onClick={() => actions.remove(i)}
                          >
                            Archive
                          </button>
                        )}
                      </>
                    )}
                  {!actions && audit && (
                    <button className="small-action" onClick={() => audit(i)}>
                      View history
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Status({ status }) {
  return (
    <span className={`status status-${status?.toLowerCase()}`}>
      {statusLabel(status)}
    </span>
  );
}
function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">▤</div>
      <b>{title}</b>
      <p>{detail}</p>
    </div>
  );
}
function InvoiceEditor({ editor, setEditor, onSubmit, onBack, busy }) {
  if (!editor)
    return (
      <EmptyState
        title="Invoice form unavailable"
        detail="Return to invoices and try again."
      />
    );
  const form = editor.form;
  function set(key, value) {
    setEditor({ ...editor, form: { ...form, [key]: value } });
  }
  function setItem(index, key, value) {
    const rows = form.items.map((row, i) =>
      i === index ? { ...row, [key]: value } : row,
    );
    set("items", rows);
  }
  const total = form.items.reduce(
    (sum, item) =>
      sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0),
    0,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INVOICE MANAGEMENT</div>
          <h1>{editor.id ? "Edit invoice" : "Create invoice"}</h1>
          <p>
            Invoice details and line items are recorded in the audit history.
          </p>
        </div>
        {onBack && <button className="button button-quiet" type="button" onClick={onBack}>Back to overview</button>}
      </div>
      <form onSubmit={onSubmit}>
        <section className="panel form-panel">
          <div className="section-title">
            <div className="number-badge">01</div>
            <div>
              <h2>Invoice details</h2>
              <p>Set the reference number and key dates.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Invoice number <RequiredMark />
              <input
                required
                maxLength="100"
                pattern="[A-Za-z0-9]+"
                title="Use letters and numbers only."
                value={form.invoiceNumber}
                onChange={(e) => set("invoiceNumber", e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
                placeholder="Invoice number"
              />
            </label>
            <label>
              Issue date <RequiredMark />
              <input
                type="date"
                required
                value={form.issuedDt}
                onChange={(e) => set("issuedDt", e.target.value)}
              />
            </label>
            <label>
              Due date <RequiredMark />
              <input
                type="date"
                required
                min={form.issuedDt}
                value={form.dueDt}
                onChange={(e) => set("dueDt", e.target.value)}
              />
            </label>
          </div>
        </section>
        <section className="panel form-panel">
          <div className="section-title">
            <div className="number-badge">02</div>
            <div>
              <h2>Line items</h2>
              <p>Add the goods or services included in this invoice.</p>
            </div>
          </div>
          {form.items.map((item, index) => (
            <div className="item-editor" key={index}>
              <div className="item-title">
                ITEM {String(index + 1).padStart(2, "0")}
                {form.items.length > 1 && (
                  <button
                    type="button"
                    className="remove-line"
                    onClick={() =>
                      set(
                        "items",
                        form.items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="form-grid item-grid">
                <label>
                  Description <RequiredMark />
                  <input
                    required
                    value={item.itemName}
                    onChange={(e) => setItem(index, "itemName", e.target.value)}
                    placeholder="Product or service"
                  />
                </label>
                <label>
                  Unit price <RequiredMark />
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={item.unitPrice}
                    onChange={(e) =>
                      setItem(index, "unitPrice", e.target.value)
                    }
                    placeholder="0"
                  />
                </label>
                <label>
                  Quantity <RequiredMark />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={item.quantity}
                    onChange={(e) => setItem(index, "quantity", e.target.value)}
                    placeholder="1"
                  />
                </label>
                <label>
                  Remarks <span className="optional-label">(Optional)</span>
                  <input
                    value={item.remarks}
                    onChange={(e) => setItem(index, "remarks", e.target.value)}
                    placeholder="Additional details"
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="add-line"
            onClick={() =>
              set("items", [
                ...form.items,
                { itemName: "", unitPrice: "", quantity: 1, remarks: "" },
              ])
            }
          >
            ＋ Add another line item
          </button>
          <div className="total-row">
            <span>Invoice total</span>
            <strong>{money(total)}</strong>
          </div>
        </section>
        <div className="form-actions">
          <button type="submit" value="draft" className="button button-quiet" disabled={busy}>
            {busy ? "Saving…" : "Save as Draft"}
          </button>
          <button type="submit" value="submit" className="button button-primary" disabled={busy}>
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      </form>
    </>
  );
}
function ApprovalList({ invoices, note, setNote, decide, busy }) {
  const newestFirst = [...invoices].sort(
    (a, b) => new Date(b.createdDt || b.issuedDt) - new Date(a.createdDt || a.issuedDt),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">APPROVAL WORKFLOW</div>
          <h1>My approvals</h1>
          <p>Review each invoice carefully before recording your decision.</p>
        </div>
        <div className="queue-chip">
          <span className="secure-dot" />
          {invoices.length} awaiting your review
        </div>
      </div>
      {invoices.length === 0 ? (
        <section className="panel">
          <EmptyState
            title="Nothing waiting on you"
            detail="New invoices assigned to your level will appear here."
          />
        </section>
      ) : (
        <div className="approval-grid">
          {newestFirst.map((invoice) => (
            <article className="panel approval-card" key={invoice.invoiceId}>
              <div className="approval-card-head">
                <div>
                  <span className="eyebrow">INVOICE REVIEW</span>
                  <h2>{invoice.invoiceNumber}</h2>
                </div>
                <Status status={displayedInvoiceStatus(invoice)} />
              </div>
              <div className="approval-amount">
                {money(invoice.totalAmount)}
              </div>
              <div className="approval-meta">
                <span>
                  Issued <b>{date(invoice.issuedDt)}</b>
                </span>
                <span>
                  Due <b>{date(invoice.dueDt)}</b>
                </span>
              </div>
              <div className="approval-lines">
                <b>Line items</b>
                {invoice.items?.map((item) => (
                  <div key={item.invoiceItemsId}>
                    <span>
                      {item.itemName} × {item.quantity}
                    </span>
                    <b>{money(item.totalPrice)}</b>
                  </div>
                ))}
              </div>
              <label className="remarks-label">
                Decision remarks{" "}
                <span className="optional-label">
                  REQUIRED TO REJECT OR RETURN
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Remarks"
                  rows="3"
                />
              </label>
              <div className="decision-actions">
                <button
                  disabled={busy}
                  className="button button-danger-outline"
                  onClick={() => decide(invoice, "reject")}
                >
                  Reject
                </button>
                <button
                  disabled={busy}
                  className="button button-quiet"
                  onClick={() => decide(invoice, "return")}
                >
                  Return for revision
                </button>
                <button
                  disabled={busy}
                  className="button button-primary"
                  onClick={() => decide(invoice, "approve")}
                >
                  Approve
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function AuditPage({ audit, onShowDetails }) {
  const [page, setPage] = useState(1);
  const entries = [...audit].sort((a, b) => new Date(b.logDt) - new Date(a.logDt));
  const pageCount = Math.max(1, Math.ceil(entries.length / 10));
  const currentPage = Math.min(page, pageCount);
  const pageEntries = entries.slice((currentPage - 1) * 10, currentPage * 10);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RECORD OF ACTIVITY</div>
          <h1>Audit trail</h1>
          <p>
            Record of activity across the workspace.
          </p>
        </div>
      </div>
      <section className="panel audit-panel">
        {entries.length === 0 ? <EmptyState title="No recorded actions" detail="Login, logout, and invoice activity will appear here." /> : <><div className="table-wrap"><table className="audit-table"><colgroup><col className="audit-col-date" /><col className="audit-col-action" /><col className="audit-col-user" /><col className="audit-col-invoice" /><col className="audit-col-details" /></colgroup><thead><tr><th>DATE & TIME</th><th>ACTION</th><th>USER</th><th>INVOICE</th><th>DETAILS</th></tr></thead><tbody>{pageEntries.map((entry) => <tr key={entry.auditTrailsId}><td>{new Date(entry.logDt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td><td>{entry.action.replaceAll("_", " ")}</td><td>{entry.username}<small className="cell-sub">{entry.userRole.replaceAll("_", " ")}</small></td><td>{entry.invoiceNumber || "—"}</td><td><button className="small-action" onClick={() => onShowDetails(entry)}>View details</button></td></tr>)}</tbody></table></div><Pagination page={currentPage} totalItems={entries.length} onPageChange={setPage} /></>}
      </section>
    </>
  );
}
function AuditDetails({ raw, action }) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return <span>{raw || "Activity recorded."}</span>;
  }
  const isReturnedInvoiceRevision = action === "UPDATE_INVOICE" && data.before?.invoiceStatus === "RETURNED_TO_ADMIN";
  const isAccountChange = ["CREATE_USER", "UPDATE_USER", "DELETE_USER"].includes(action);
  const value = (item) => item == null || item === "" ? "—" : Array.isArray(item) ? <div className="audit-item-list">{item.map((line, index) => <div key={`${line.itemName}-${index}`}><span>{line.itemName || "—"}</span><small>{line.quantity ?? "—"} × {money(line.unitPrice)}</small></div>)}</div> : typeof item === "object" ? Object.entries(item).map(([key, child]) => `${key}: ${child ?? "—"}`).join(" · ") : String(item);
  const label = (field) => field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).replace(/^./, (letter) => letter.toUpperCase());
  const invoiceActions = ["CREATE_INVOICE", "UPDATE_INVOICE", "DELETE_INVOICE", "SUBMIT", "APPROVE_LV1", "APPROVE_LV2", "REJECT", "RETURN_TO_ADMIN"];
  if (invoiceActions.includes(action) && !isReturnedInvoiceRevision) {
    const record = data.after || data.before || {};
    const fields = Object.keys(record).filter((field) => field !== "items" || record.items?.length);
    return <div className="audit-change-table"><table className="audit-record-table"><thead><tr><th>FIELD</th><th>VALUE</th></tr></thead><tbody>{fields.map((field) => <tr key={field}><th>{label(field)}</th><td>{value(record[field])}</td></tr>)}</tbody></table>{data.remarks && <small>Remarks: {data.remarks}</small>}</div>;
  }
  if (!isReturnedInvoiceRevision && !isAccountChange) return <span>{data.remarks || auditSummary(data) || "Activity recorded."}</span>;
  const fields = [...new Set([...Object.keys(data.before || {}), ...Object.keys(data.after || {})])].filter((field) => field !== "invoiceStatus");
  return <div className="audit-change-table"><table className="audit-compare-table"><thead><tr><th>FIELD</th><th>BEFORE</th><th>AFTER</th></tr></thead><tbody>{fields.map((field) => <tr key={field}><th>{label(field)}</th><td>{value(data.before?.[field])}</td><td>{value(data.after?.[field])}</td></tr>)}</tbody></table>{data.remarks && <small>Remarks: {data.remarks}</small>}</div>;
}
function AuditDetailDialog({ entry, close }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="audit-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><div className="eyebrow">AUDIT RECORD</div><h2 id="audit-detail-title">{entry.action.replaceAll("_", " ")}</h2><p>{entry.username} · {entry.userRole.replaceAll("_", " ")} · {new Date(entry.logDt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>{entry.invoiceNumber && <p>Invoice: <b>{entry.invoiceNumber}</b></p>}<AuditDetails raw={entry.auditDetails} action={entry.action} /><div className="form-actions"><button className="button button-quiet" onClick={close}>Close</button></div></section></div>;
}
function RequiredMark() { return <span className="required-mark" aria-label="required">*</span>; }
function InvoiceConfirm({ editor, payload, busy, back, confirm }) {
  const before = editor.original || {};
  const isReturnedEdit = before.invoiceStatus === "RETURNED_TO_ADMIN";
  return <div className="confirm-page">
    <div className="page-heading"><div><div className="eyebrow">FINAL REVIEW</div><h1>Confirm invoice submission</h1><p>Check the invoice details before sending it for approval.</p></div></div>
    <section className="panel form-panel"><div className="confirm-summary"><div><span>STATUS</span><Status status={before.invoiceStatus || "DRAFT"} /></div><div><span>INVOICE TOTAL</span><b>{money(payload.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0))}</b></div></div><div className="panel-heading"><div><h2>Invoice details</h2><p>{isReturnedEdit ? `Review the changes to ${payload.invoiceNumber}.` : "Review the invoice details before submission."}</p></div></div>
      {isReturnedEdit ? <BeforeAfterTables before={before} payload={payload} /> : <><div className="confirm-fields"><div><span>Invoice number</span><b>{payload.invoiceNumber}</b></div><div><span>Issue date</span><b>{date(payload.issuedDt)}</b></div><div><span>Due date</span><b>{date(payload.dueDt)}</b></div></div><div className="table-wrap"><table><thead><tr><th>DESCRIPTION</th><th>UNIT PRICE</th><th>QUANTITY</th><th>REMARKS</th><th>TOTAL</th></tr></thead><tbody>{payload.items.map((item, index) => <tr key={`${item.itemName}-${index}`}><td>{item.itemName}</td><td>{money(item.unitPrice)}</td><td>{item.quantity}</td><td>{item.remarks || "—"}</td><td className="amount-cell">{money(Number(item.unitPrice) * Number(item.quantity))}</td></tr>)}</tbody></table></div></>}
    </section>
    <div className="form-actions"><button className="button button-quiet" onClick={back}>Back to edit</button><button className="button button-primary" disabled={busy} onClick={confirm}>{busy ? "Submitting…" : "Submit"}</button></div>
  </div>;
}
function BeforeAfterTables({ before, payload }) {
  const priorItems = before.items || [];
  const nextItems = payload.items || [];
  const changed = (oldValue, newValue) => String(oldValue ?? "") !== String(newValue ?? "");
  const renderItems = (items, side) => <div className={`before-after-card ${side}`}><h3>{side === "before" ? "Before" : "After"}</h3><div className="table-wrap"><table><thead><tr><th>DESCRIPTION</th><th>UNIT PRICE</th><th>QTY</th><th>REMARKS</th><th>TOTAL</th></tr></thead><tbody>{items.length ? items.map((item, index) => {
    const old = priorItems[index] || {};
    const next = nextItems[index] || {};
    const valueChanged = (key) => side === "after" && changed(old[key], next[key]);
    const removed = side === "before" && index >= nextItems.length;
    return <tr className={removed ? "change-removed" : ""} key={`${index}-${item.itemName}`}><td className={valueChanged("itemName") ? "change-highlight-cell" : ""}>{item.itemName || "—"}</td><td className={valueChanged("unitPrice") ? "change-highlight-cell" : ""}>{money(item.unitPrice)}</td><td className={valueChanged("quantity") ? "change-highlight-cell" : ""}>{item.quantity ?? "—"}</td><td className={valueChanged("remarks") ? "change-highlight-cell" : ""}>{item.remarks || "—"}</td><td className="amount-cell">{money(Number(item.unitPrice || 0) * Number(item.quantity || 0))}</td></tr>;
  }) : <tr><td colSpan="5" className="empty-cell">No line items</td></tr>}</tbody></table></div><div className="before-after-total"><span>Invoice total</span><b>{money(items.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0))}</b></div></div>;
  const metadata = [
    ["Invoice number", before.invoiceNumber, payload.invoiceNumber],
    ["Issue date", before.issuedDt, payload.issuedDt],
    ["Due date", before.dueDt, payload.dueDt],
  ];
  return <><div className="before-after-metadata">{["before", "after"].map((side) => <div className={`before-after-card ${side}`} key={side}><h3>{side === "before" ? "Before" : "After"}</h3><table><tbody>{metadata.map(([label, oldValue, newValue]) => { const value = side === "before" ? oldValue : newValue; return <tr className={side === "after" && String(oldValue ?? "") !== String(newValue ?? "") ? "change-highlight-row" : ""} key={label}><th>{label}</th><td>{label.toLowerCase().includes("date") ? date(value) : value || "—"}</td></tr>; })}</tbody></table></div>)}</div><div className="before-after-items">{renderItems(priorItems, "before")}{renderItems(nextItems, "after")}</div></>;
}
function InvoiceDetail({ invoice, acknowledgement, canViewTrail, back, done, openTrail }) {
  if (!invoice) return <EmptyState title="Invoice unavailable" detail="Return to the invoice list and select a record." />;
  return <>
    <div className="page-heading"><div><div className="eyebrow">INVOICE ACKNOWLEDGEMENT</div><h1>{invoice.invoiceNumber}</h1><p>Review the saved invoice details and status history.</p></div><button className="button button-quiet" onClick={acknowledgement ? done : back}>{acknowledgement ? "Done" : "Back"}</button></div>
    <section className="panel form-panel"><div className="audit-summary"><div><span>STATUS</span><Status status={displayedInvoiceStatus(invoice)} /></div><div><span>ISSUED</span><b>{date(invoice.issuedDt)}</b></div><div><span>DUE DATE</span><b>{date(invoice.dueDt)}</b></div><div><span>TOTAL</span><b>{money(invoice.totalAmount)}</b></div></div><div className="panel-heading"><div><h2>Invoice details</h2><p>Created by {invoice.createdBy || "—"}</p></div></div><div className="table-wrap"><table><thead><tr><th>DESCRIPTION</th><th>UNIT PRICE</th><th>QUANTITY</th><th>REMARKS</th><th>TOTAL</th></tr></thead><tbody>{invoice.items?.map((item) => <tr key={item.invoiceItemsId}><td>{item.itemName}</td><td>{money(item.unitPrice)}</td><td>{item.quantity}</td><td>{item.remarks || "—"}</td><td className="amount-cell">{money(item.totalPrice)}</td></tr>)}</tbody></table></div></section>
    {canViewTrail && <div className="invoice-trail-action"><button className="button button-quiet" onClick={openTrail}>View invoice trail</button></div>}
  </>;
}
function InvoiceTrailPage({ invoice, audit, back }) {
  const statusActions = ["CREATE_INVOICE", "SUBMIT", "APPROVE_LV1", "APPROVE_LV2", "REJECT", "RETURN_TO_ADMIN", "DELETE_INVOICE"];
  const entries = audit.filter((entry) => statusActions.includes(entry.action)).sort((a, b) => new Date(b.logDt) - new Date(a.logDt));
  const labels = { CREATE_INVOICE: "Draft created", SUBMIT: "Submitted for approval", APPROVE_LV1: "Approved by Level 1 · Awaiting Level 2", APPROVE_LV2: "Invoice approved", REJECT: "Invoice rejected", RETURN_TO_ADMIN: "Returned for revision", DELETE_INVOICE: "Invoice archived" };
  return <><div className="page-heading"><div><div className="eyebrow">INVOICE WORKFLOW</div><h1>Invoice trail</h1><p>{invoice?.invoiceNumber || "Invoice"} · Status and decision history.</p></div><button className="button button-quiet" onClick={back}>Back to invoice</button></div><section className="panel journey-panel"><div className="journey-summary"><div><span>CURRENT STATUS</span><Status status={displayedInvoiceStatus(invoice || {})} /></div><div><span>STATUS EVENTS</span><b>{entries.length}</b></div></div>{entries.length ? <div className="journey">{entries.map((entry, index) => { let details = {}; try { details = JSON.parse(entry.auditDetails || "{}"); } catch { /* Keep the trail step readable if old details are malformed. */ } const current = index === 0; return <article className={`journey-step ${current ? "current" : ""}`} key={entry.auditTrailsId}><div className={`journey-node journey-${entry.action.toLowerCase()}`}>{current ? "●" : "✓"}</div><div className="journey-card"><div className="journey-card-head"><div><h2>{labels[entry.action] || entry.action.replaceAll("_", " ")}</h2><span>{entry.username} · {entry.userRole.replaceAll("_", " ")}</span></div><time>{new Date(entry.logDt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time></div>{details.remarks && <p className="journey-remarks">{details.remarks}</p>}</div></article>; })}</div> : <EmptyState title="No status changes yet" detail="Status changes will appear here as the invoice moves through its lifecycle." />}</section></>;
}
function ConfirmDialog({ title, message, close, confirm }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="eyebrow">CONFIRM ACTION</div><h2 id="confirm-title">{title}</h2><p>{message}</p><div className="form-actions"><button className="button button-quiet" onClick={close}>Cancel</button><button className="button button-primary" onClick={confirm}>Confirm</button></div></section></div>; }
function PasswordChangeDialog({ close, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const currentPassword = form.get("currentPassword");
    const newPassword = form.get("newPassword");
    if (newPassword !== form.get("confirmPassword")) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.put("/auth/password", { currentPassword, newPassword });
      onDone();
      close();
    } catch (e) {
      setError(e.response?.data?.message || "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><section className="confirm-dialog password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title"><div className="eyebrow">ACCOUNT SECURITY</div><h2 id="password-dialog-title">Change password</h2><p>Enter your current password, then choose a new password with at least 8 characters.</p>{error && <div className="alert alert-error password-dialog-error" role="alert">{error}</div>}<form onSubmit={submit}><label className="password-change-field"><span>Current password</span><PasswordInput name="currentPassword" autoComplete="current-password" required /></label><label className="password-change-field"><span>New password</span><PasswordInput name="newPassword" autoComplete="new-password" minLength="8" required /></label><label className="password-change-field"><span>Confirm new password</span><PasswordInput name="confirmPassword" autoComplete="new-password" minLength="8" required /></label><div className="form-actions"><button type="button" className="button button-quiet" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button></div></form></section></div>;
}
function auditSummary(data) {
  const state = data.after || {};
  if (data.event) return data.event.replaceAll("_", " ");
  return state.invoiceStatus
    ? `Invoice status: ${statusLabel(state.invoiceStatus)}`
    : "Invoice details recorded.";
}
function UsersPage({
  users,
  saveUser,
  busy,
  removeUser,
  editor,
  setEditor,
  currentUserId,
  isEditingOther,
}) {
  const cancelEdit = () => {
    setEditor(null);
    document.getElementById("user-form")?.reset();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCESS CONTROL</div>
          <h1>Team & access</h1>
          <p>Manage administrator and approver accounts for this workspace.</p>
        </div>
      </div>
      <div className="users-layout">
        <section className="panel user-create">
          <div className="panel-heading">
            <div>
              <h2>{editor ? "Edit account" : "Add a team member"}</h2>
              <p>
                {editor
                  ? isEditingOther
                    ? "Only the role can be changed here. Members manage their own name, email, and password."
                    : "Leave password blank to keep the current password."
                  : "New accounts can sign in immediately."}
              </p>
            </div>
          </div>
          <form
            id="user-form"
            key={editor?.userId || "new"}
            onSubmit={saveUser}
            className="user-form"
            autoComplete="off"
          >
            <label>
              <span>Username <RequiredMark /></span>
              {isEditingOther ? <>
                <div className="read-only-value">{editor?.username || "—"}</div>
                <input type="hidden" name="username" value={editor?.username || ""} />
              </> : <input
                name="username"
                autoComplete="off"
                required
                maxLength="100"
                defaultValue={editor?.username || ""}
                placeholder="Username"
              />}
            </label>
            {!isEditingOther && <label>
              <span>{editor ? "New password" : <>Temporary password <RequiredMark /></>}</span>
              <PasswordInput
                name="password"
                autoComplete="new-password"
                required={!editor}
                minLength="8"
                placeholder={
                  editor
                    ? "Leave blank to keep current"
                    : "At least 8 characters"
                }
              />
            </label>}
            {isEditingOther && <input type="hidden" name="firstName" value={editor.firstName || ""} />}
            {!isEditingOther && <label>
              <span>First name <RequiredMark /></span>
              <input
                name="firstName"
                required
                defaultValue={editor?.firstName || ""}
                placeholder="First name"
              />
            </label>}
            {isEditingOther && <input type="hidden" name="lastName" value={editor.lastName || ""} />}
            {!isEditingOther && <label>
              Last name
              <input
                name="lastName"
                defaultValue={editor?.lastName || ""}
                placeholder="Last name"
              />
            </label>}
            <label>
              <span>Email</span>
              {isEditingOther ? <>
                <div className="read-only-value">{editor?.email || "—"}</div>
                <input type="hidden" name="email" value={editor?.email || ""} />
              </> : <input
                type="email"
                name="email"
                defaultValue={editor?.email || ""}
                placeholder="Email"
              />}
            </label>
            <label>
              <span>Role <RequiredMark /></span>
              <select
                name="userRole"
                required
                defaultValue={editor?.userRole || "APPROVER_LV1"}
              >
                <option value="ADMIN">Admin</option>
                <option value="APPROVER_LV1">Approver · Level 1</option>
                <option value="APPROVER_LV2">Approver · Level 2</option>
              </select>
            </label>
            <button
              className="button button-primary button-wide"
              disabled={busy}
            >
              {busy
                ? editor
                  ? "Saving…"
                  : "Creating…"
                : editor
                  ? "Save account"
                  : "Create account"}
            </button>
            {editor && (
              <button
                type="button"
                className="button button-quiet button-wide"
                onClick={cancelEdit}
              >
                Cancel edit
              </button>
            )}
          </form>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Workspace members</h2>
              <p>{users.length} registered accounts</p>
            </div>
          </div>
          <div className="member-list">
            {users.map((member) => (
              <div className="member-row" key={member.userId}>
                <div className="avatar">
                  {member.firstName?.[0] || member.username[0]}
                </div>
                <div className="member-copy">
                  <b>
                    {member.firstName} {member.lastName || ""}
                  </b>
                  <span>
                    {member.username}
                    {member.email ? ` · ${member.email}` : ""}
                  </span>
                </div>
                <span className="role-pill">
                  {member.userRole.replaceAll("_", " ")}
                </span>
                {member.username?.toLowerCase() !== "admin" && (
                  <button
                    className="small-action"
                    onClick={() => setEditor(member)}
                  >
                    Edit
                  </button>
                )}
                {member.userId !== currentUserId && member.username?.toLowerCase() !== "admin" && (
                  <button
                    className="small-action danger-text"
                    onClick={() => removeUser(member)}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export default App;
