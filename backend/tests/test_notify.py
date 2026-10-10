import smtplib

import pytest

from notify import send_non_conforming_mail

RESULT = {
    "outcome": "Non-conforming",
    "counts": {"pass": 7, "fail": 2, "review": 1},
    "product": "Citric Acid",
    "lot": "L26-10-4188",
    "supplier": "Alpina Chemicals",
}
JOB = {"id": "abc", "filename": "lot.pdf", "result": RESULT}


@pytest.fixture
def sent(monkeypatch):
    """Replaces the SMTP connection; what is done with it ends up in the returned list, the message last."""
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


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "localhost")
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")


def test_no_mail_without_smtp_settings(sent, monkeypatch):
    monkeypatch.setenv("NOTIFY_EMAIL", "quality@example.com")

    send_non_conforming_mail(JOB)

    assert sent == []


def test_the_mail_says_which_lot_does_not_conform_and_how_badly(sent, configured):
    send_non_conforming_mail(JOB)

    msg = sent[-1]
    assert msg["To"] == "quality@example.com" and msg["Subject"] == "Non-conforming CoA: L26-10-4188"
    body = msg.get_content()
    for expected in (
        "lot.pdf does not conform",
        "Product: Citric Acid",
        "Lot: L26-10-4188",
        "Supplier: Alpina Chemicals",
        "7 pass, 2 fail, 1 to review",
    ):
        assert expected in body


def test_what_the_certificate_does_not_state_is_left_out(sent, configured):
    send_non_conforming_mail({**JOB, "result": {**RESULT, "lot": None, "supplier": None}})

    msg = sent[-1]
    assert msg["Subject"] == "Non-conforming CoA: lot.pdf"  # no lot to name: the file
    assert "Lot:" not in msg.get_content() and "Supplier:" not in msg.get_content()
    assert "Product: Citric Acid" in msg.get_content()


@pytest.mark.parametrize(
    "env, sender",
    [
        ({}, "coa-agent@localhost"),  # no login either: the local default
        ({"SMTP_USER": "resend"}, "resend"),
        ({"SMTP_USER": "resend", "SMTP_FROM": "alerts@example.com"}, "alerts@example.com"),
    ],
)
def test_the_sender_is_smtp_from_else_the_login_else_a_local_default(sent, configured, monkeypatch, env, sender):
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    send_non_conforming_mail(JOB)

    assert sent[-1]["From"] == sender


def test_a_login_means_starttls_then_login(sent, configured, monkeypatch):
    monkeypatch.setenv("SMTP_USER", "resend")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")

    send_non_conforming_mail(JOB)

    assert sent[:3] == ["connect localhost:587", "starttls", "login resend"]


@pytest.mark.parametrize(
    "app_url, link",
    [
        (None, None),  # no APP_URL, no link
        ("http://localhost:3000", "Open the job: http://localhost:3000/runs/abc"),
        ("https://coa.example.com/", "Open the job: https://coa.example.com/runs/abc"),  # a trailing slash does not double up
    ],
)
def test_the_mail_links_to_the_job_page_when_the_app_url_is_known(sent, configured, monkeypatch, app_url, link):
    if app_url:
        monkeypatch.setenv("APP_URL", app_url)

    send_non_conforming_mail(JOB)

    body = sent[-1].get_content()
    assert (link in body) if link else ("/runs/" not in body)
