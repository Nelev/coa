import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

import auth
import main

CLIENT_ID = "client_test"
PROTECTED = [("get", "/jobs"), ("post", "/jobs"), ("get", "/jobs/abc"), ("get", "/jobs/abc/pdf"), ("post", "/jobs/abc/decision")]


def new_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def key():
    return new_key()  # the private key WorkOS's key set stands in for


@pytest.fixture
def real_auth(monkeypatch, key):
    """The real sign-in check, with WorkOS's key set replaced by one whose private key the test holds."""
    monkeypatch.setenv("WORKOS_CLIENT_ID", CLIENT_ID)

    jwk = jwt.PyJWK.from_dict(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True))
    keys = SimpleNamespace(get_signing_key_from_jwt=lambda _token: jwk)
    monkeypatch.setattr(auth, "jwks_client", lambda _client_id: keys)
    return TestClient(main.app)


def token(key, **claims):
    return jwt.encode({"sub": "user_1", "exp": int(time.time()) + 300, **claims}, key, algorithm="RS256")


def bearer(value):
    return {"Authorization": f"Bearer {value}"}


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_a_request_without_a_token_is_refused(real_auth, method, path):
    response = getattr(real_auth, method)(path)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_a_valid_token_is_let_through(real_auth, key, monkeypatch):
    monkeypatch.setattr(main, "store", SimpleNamespace(all=lambda: []), raising=False)  # the lifespan is not running
    assert real_auth.get("/jobs", headers=bearer(token(key))).status_code == 200


def test_an_expired_token_is_refused(real_auth, key):
    assert real_auth.get("/jobs", headers=bearer(token(key, exp=int(time.time()) - 10))).status_code == 401


def test_a_token_signed_with_another_key_is_refused(real_auth):
    assert real_auth.get("/jobs", headers=bearer(token(new_key()))).status_code == 401


def test_a_token_without_a_subject_is_refused(real_auth, key):
    forged = jwt.encode({"exp": int(time.time()) + 300}, key, algorithm="RS256")
    assert real_auth.get("/jobs", headers=bearer(forged)).status_code == 401


def test_garbage_instead_of_a_token_is_refused(real_auth):
    assert real_auth.get("/jobs", headers=bearer("not-a-jwt")).status_code == 401


def test_the_api_stays_closed_when_the_client_id_is_not_set(real_auth, key, monkeypatch):
    monkeypatch.delenv("WORKOS_CLIENT_ID")
    response = real_auth.get("/jobs", headers=bearer(token(key)))
    assert response.status_code == 503
    assert "WORKOS_CLIENT_ID" in response.json()["detail"]


def test_health_needs_no_token(real_auth):
    assert real_auth.get("/health").status_code == 200


def test_the_preflight_needs_no_token_and_allows_the_authorization_header(real_auth):
    headers = {"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"}
    response = real_auth.options("/jobs", headers=headers)
    assert response.status_code == 200
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
