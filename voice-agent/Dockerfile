# The voice agent of «المساعد بالاجتماعات» (see README.md). The models are downloaded once into the /models volume.
# Built for the processor unless the build argument GPU=1 (docker-compose.gpu.yml) adds the libraries of an NVIDIA graphics card (about 1 GB more to download).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG GPU=0
COPY requirements.txt requirements-gpu.txt ./
RUN if [ "$GPU" = "1" ]; then pip install --no-cache-dir -r requirements.txt -r requirements-gpu.txt; else pip install --no-cache-dir -r requirements.txt; fi
COPY logic.py notes.py stt_device.py stt_probe.py tashkeel.py stt_groq.py tts_edge.py tts_gemini.py agent.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV HF_HOME=/models/hf PORT=8080 PYTHONUNBUFFERED=1
VOLUME /models
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8080'),timeout=4)" || exit 1
ENTRYPOINT ["./entrypoint.sh"]
