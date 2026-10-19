import os

from fastapi.responses import JSONResponse

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "20")) * 1024 * 1024


class UploadLimit:
    """Refuses an upload that is too large before its body is read: the multipart parser would spool any size to disk.

    A body needs a Content-Length to be checked, and the server holds the client to it. Added before the CORS middleware, which then
    wraps it, so the browser can read the refusal.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "POST" and scope["path"] == "/jobs":
            length = dict(scope["headers"]).get(b"content-length", b"")
            if not length.isdigit():
                return await JSONResponse({"detail": "the upload needs a Content-Length"}, status_code=411)(scope, receive, send)
            if int(length) > MAX_UPLOAD_BYTES:
                detail = f"the file is larger than {MAX_UPLOAD_BYTES // 1024 // 1024} MB"
                return await JSONResponse({"detail": detail}, status_code=413)(scope, receive, send)
        await self.app(scope, receive, send)
