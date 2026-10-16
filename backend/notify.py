import os
import smtplib
from email.message import EmailMessage


def send_mail(subject: str, body: str) -> bool:
    """Mail `body` to NOTIFY_EMAIL over SMTP; False, without sending, unless SMTP_HOST and NOTIFY_EMAIL are set (see the README)."""
    host, to = os.getenv("SMTP_HOST"), os.getenv("NOTIFY_EMAIL")
    if not host or not to:
        return False
    user = os.getenv("SMTP_USER")
    msg = EmailMessage()
    msg["From"] = os.getenv("SMTP_FROM") or user or "coa-agent@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
        if user:
            smtp.starttls()
            smtp.login(user, os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(msg)
    return True


def non_conforming_message(filename: str, job_id: str | None, result: dict) -> tuple[str, str]:
    """The subject and body of the mail about a non-conforming lot: its product, lot, supplier, test counts and a link to the job."""
    lines = [f"{filename} does not conform to the plant specification.", ""]
    for label, value in (("Product", result.get("product")), ("Lot", result.get("lot")), ("Supplier", result.get("supplier"))):
        if value:  # only what the certificate stated
            lines.append(f"{label}: {value}")
    counts = result["counts"]
    lines.append(f"Tests: {counts['pass']} pass, {counts['fail']} fail, {counts['review']} to review")
    app_url = os.getenv("APP_URL", "").rstrip("/")
    if app_url and job_id:  # a link only when we know where the frontend is
        lines += ["", f"Open the job: {app_url}/runs/{job_id}"]
    return f"Non-conforming CoA: {result.get('lot') or filename}", "\n".join(lines)


def send_non_conforming_mail(job: dict) -> None:
    """Mail a non-conforming lot's summary to NOTIFY_EMAIL; a no-op unless SMTP_HOST and NOTIFY_EMAIL are set (see the README)."""
    send_mail(*non_conforming_message(job["filename"], job["id"], job["result"]))
