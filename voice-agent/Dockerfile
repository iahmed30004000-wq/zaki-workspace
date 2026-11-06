# The voice agent of «المساعد بالاجتماعات» (see README.md). CPU only; the models are downloaded once into the /models volume.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY logic.py tashkeel.py stt_groq.py tts_edge.py tts_gemini.py agent.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV HF_HOME=/models/hf PORT=8080 PYTHONUNBUFFERED=1
VOLUME /models
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8080'),timeout=4)" || exit 1
ENTRYPOINT ["./entrypoint.sh"]
