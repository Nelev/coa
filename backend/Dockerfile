FROM python:3.14-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# the uploaded PDFs (main.py's default data directory); mount a volume here to keep them
VOLUME /app/data

EXPOSE 8000
# one process: the job queue is in memory
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
