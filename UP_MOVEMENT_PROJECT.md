# UP Movement Video — Separate Project

This branch is a separate experiment based on the working Viral Facts Video Automation baseline. `main` is untouched.

## Target
Vertical 9:16 cinematic video (~20s) matching the reference motion language:
- camera starts high/above the subject
- fast cinematic dive downward
- strong depth/parallax and tunnel-like perspective
- surprise reveal
- dynamic push-in
- natural motion
- final movement returns attention toward the main subject/hand
- not a static slideshow or simple zoom

## Pipeline
Prompt/topic → Gemini scene direction → Cloudflare FLUX images → Wan 2.2 image-to-video → FFmpeg 20s vertical reel.

## Secrets
Uses the existing baseline secrets:
- GEMINI_API_KEY
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

Facebook/YouTube posting is intentionally NOT enabled in this first test.
