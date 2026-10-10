import smtplib

import pytest

from notify import send_failure_mail

JOB = {"id": "abc", "filename": "lot.pdf", "statuses": ["Reading the PDF"]}


@pytest.fixture
def sent(monkeypatch):
    """Replaces the SMTP connection; the messages sent end up in the returned list."""
    messages = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            messages.append(f"connect {host}:{port}")

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def starttls(self):
            messages.append("starttls")

        def login(self, user, password):
            messages.append(f"login {user}")

        def send_message(self, msg):
            messages.append(msg)

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return messages


def test_no_mail_without_smtp_settings(sent, monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")

    send_failure_mail(JOB, "model unavailable")

    assert sent == []


def test_the_failure_is_mailed_with_the_last_step(sent, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "localhost")
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")

    send_failure_mail(JOB, "model unavailable")

    msg = sent[-1]
    assert msg["To"] == "quality@example.com" and msg["Subject"] == "CoA job failed: lot.pdf"
    assert "model unavailable" in msg.get_content() and "Last step reached: Reading the PDF" in msg.get_content()


def test_no_last_step_note_when_the_job_never_started(sent, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "localhost")
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")

    send_failure_mail({**JOB, "statuses": []}, "boom")

    assert "Last step" not in sent[-1].get_content()


def test_the_sender_is_smtp_from_when_set_else_the_login(sent, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "localhost")
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")
    monkeypatch.delenv("SMTP_FROM", raising=False)

    send_failure_mail(JOB, "boom")  # no login either: the local default
    assert sent[-1]["From"] == "coa-agent@localhost"

    monkeypatch.setenv("SMTP_USER", "resend")
    send_failure_mail(JOB, "boom")
    assert sent[-1]["From"] == "resend"

    monkeypatch.setenv("SMTP_FROM", "alerts@example.com")
    send_failure_mail(JOB, "boom")
    assert sent[-1]["From"] == "alerts@example.com"


def test_a_login_means_starttls_then_login(sent, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")
    monkeypatch.setenv("SMTP_USER", "resend")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")

    send_failure_mail(JOB, "boom")

    assert sent[:3] == ["connect smtp.example.com:587", "starttls", "login resend"]
