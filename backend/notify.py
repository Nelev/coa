import json
import os
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage

RESEND_URL = "https://api.resend.com/emails"


def send_mail_resend(subject: str, body: str, key: str, to: str) -> None:
    """Mail `body` to `to` through Resend's HTTP API (HTTPS, port 443), for hosts that block the SMTP ports, such as Render's free plan."""
    request = urllib.request.Request(
        RESEND_URL,
        data=json.dumps({"from": os.getenv("SMTP_FROM") or "onboarding@resend.dev", "to": [to], "subject": subject, "text": body}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "coa-agent"},
    )
    try:
        urllib.request.urlopen(request, timeout=10).close()
    except urllib.error.HTTPError as error:  # Resend says why in the body: a wrong key, an unverified sender or recipient
        raise RuntimeError(f"Resend answered {error.code}: {error.read().decode(errors='replace')[:300]}") from error


def send_mail(subject: str, body: str) -> bool:
    """Mail `body` to NOTIFY_EMAIL, through Resend's HTTP API when RESEND_API_KEY is set, else over SMTP; False, without sending,
    unless NOTIFY_EMAIL and one of RESEND_API_KEY or SMTP_HOST are set (see the README)."""
    host, to, key = os.getenv("SMTP_HOST"), os.getenv("NOTIFY_EMAIL"), os.getenv("RESEND_API_KEY")
    if not to or not (key or host):
        return False
    if key:
        send_mail_resend(subject, body, key, to)
        return True
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
    """Mail a non-conforming lot's summary to NOTIFY_EMAIL; a no-op without it, or without RESEND_API_KEY or SMTP_HOST (see the README)."""
    send_mail(*non_conforming_message(job["filename"], job["id"], job["result"]))
