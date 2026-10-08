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
    """Run the agent on an uploaded CoA PDF, streaming one JSON line per finished step.

    Lines: {"step": <node>} per step, then {"done": <json-render UI spec>} or {"error": <message>}.
    """
    pdf = tempfile.NamedTemporaryFile(suffix=".pdf")
    shutil.copyfileobj(file.file, pdf)
    pdf.flush()

    # a plain generator: Starlette iterates it in a worker thread, so the minutes-long agent run doesn't block the server
    def events():
        try:
            for update in agent_app.stream({"document_path": pdf.name}, stream_mode="updates"):
                for node, output in update.items():
                    yield json.dumps({"step": node}) + "\n"
                    if output and "ui_spec" in output:
                        yield json.dumps({"done": output["ui_spec"]}) + "\n"
        except Exception as error:
            yield json.dumps({"error": str(error) or type(error).__name__}) + "\n"
        finally:
            pdf.close()  # removes the temp file

    return StreamingResponse(events(), media_type="application/x-ndjson")
