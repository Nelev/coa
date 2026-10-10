import os
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# the frontend signs people in with WorkOS AuthKit and sends the session's access token with every request
bearer = HTTPBearer(auto_error=False)


@lru_cache
def jwks_client(client_id: str) -> jwt.PyJWKClient:
    """The public keys WorkOS signs this application's tokens with; cached, and fetched again when a token names an unknown key."""
    return jwt.PyJWKClient(f"https://api.workos.com/sso/jwks/{client_id}")


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def require_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> dict:
    """The claims of the signed-in person, or 401. Tokens are checked against the keys of WORKOS_CLIENT_ID: only this application's pass.

    A plain `def`: FastAPI runs it in a thread, where fetching the keys may block.
    """
    client_id = os.getenv("WORKOS_CLIENT_ID")
    if not client_id:  # never fall back to an open API
        raise HTTPException(status_code=503, detail="authentication is not configured: set WORKOS_CLIENT_ID")
    if credentials is None:
        raise unauthorized("sign in first")
    token = credentials.credentials
    try:
        key = jwks_client(client_id).get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=["RS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(status_code=503, detail="the sign-in keys cannot be fetched") from None
    except jwt.PyJWTError:  # bad signature, expired, malformed, unknown key
        raise unauthorized("the session is not valid, sign in again") from None
