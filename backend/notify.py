import os
import smtplib
from email.message import EmailMessage


def send_failure_mail(job: dict, error: str) -> None:
    """Mail a failed job's error to NOTIFY_EMAIL. Does nothing unless SMTP_HOST and NOTIFY_EMAIL are set.

    SMTP_USER and SMTP_PASSWORD are optional: with them the connection is encrypted and logged in (a real provider),
    without them it is a plain connection (a local mail catcher). SMTP_FROM is the sender; it defaults to SMTP_USER, which is
    not an address for every provider (Resend's login is "resend").
    """
    host, to = os.getenv("SMTP_HOST"), os.getenv("NOTIFY_EMAIL")
    if not host or not to:
        return
    user = os.getenv("SMTP_USER")
    msg = EmailMessage()
    msg["From"] = os.getenv("SMTP_FROM") or user or "coa-agent@localhost"
    msg["To"] = to
    msg["Subject"] = f"CoA job failed: {job['filename']}"
    body = f"Job {job['id']} failed:\n\n{error}"
    if job["statuses"]:  # a note only when the job got somewhere
        body += f"\n\nLast step reached: {job['statuses'][-1]}"
    msg.set_content(body)
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
        if user:
            smtp.starttls()
            smtp.login(user, os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(msg)
