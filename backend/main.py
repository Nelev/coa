import json
import shutil
import tempfile

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent.agent import app as agent_app

app = FastAPI()
# local development: the Next.js dev server calls this API straight from the browser
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["POST"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(file: UploadFile):
    """Run the agent on an uploaded CoA PDF, streaming one JSON line per event.

    Lines: {"status": <what the running node is doing>}, as each node reports it with its stream writer, then
    {"done": <json-render UI spec>} or {"error": <message>}.
    """
    pdf = tempfile.NamedTemporaryFile(suffix=".pdf")
    shutil.copyfileobj(file.file, pdf)
    pdf.flush()

    # a plain generator: Starlette iterates it in a worker thread, so the minutes-long agent run doesn't block the server
    def events():
        try:
            for chunk in agent_app.stream({"document_path": pdf.name}, stream_mode=["updates", "custom"], version="v2"):
                if chunk["type"] == "custom":  # a node reported its status
                    yield json.dumps(chunk["data"]) + "\n"
                else:  # a node finished; the node's update holds its state changes, and the last node's holds the spec
                    for update in chunk["data"].values():
                        if "ui_spec" in (update or {}):
                            yield json.dumps({"done": update["ui_spec"]}) + "\n"
        except Exception as error:
            yield json.dumps({"error": str(error) or type(error).__name__}) + "\n"
        finally:
            pdf.close()  # removes the temp file

    return StreamingResponse(events(), media_type="application/x-ndjson")
