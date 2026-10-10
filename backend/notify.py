import os
import smtplib
from email.message import EmailMessage


def send_non_conforming_mail(job: dict) -> None:
    """Mail a non-conforming lot's summary to NOTIFY_EMAIL; a no-op unless SMTP_HOST and NOTIFY_EMAIL are set (see the README)."""
    host, to = os.getenv("SMTP_HOST"), os.getenv("NOTIFY_EMAIL")
    if not host or not to:
        return
    user = os.getenv("SMTP_USER")
    result = job["result"]
    msg = EmailMessage()
    msg["From"] = os.getenv("SMTP_FROM") or user or "coa-agent@localhost"
    msg["To"] = to
    msg["Subject"] = f"Non-conforming CoA: {result.get('lot') or job['filename']}"
    lines = [f"{job['filename']} does not conform to the plant specification.", ""]
    for label, value in (("Product", result.get("product")), ("Lot", result.get("lot")), ("Supplier", result.get("supplier"))):
        if value:  # only what the certificate stated
            lines.append(f"{label}: {value}")
    counts = result["counts"]
    lines.append(f"Tests: {counts['pass']} pass, {counts['fail']} fail, {counts['review']} to review")
    app_url = os.getenv("APP_URL", "").rstrip("/")
    if app_url:  # a link only when we know where the frontend is
        lines += ["", f"Open the job: {app_url}/runs/{job['id']}"]
    msg.set_content("\n".join(lines))
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
        if user:
            smtp.starttls()
            smtp.login(user, os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(msg)
