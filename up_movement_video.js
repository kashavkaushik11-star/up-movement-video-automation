const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || "";
const HF_TOKEN = process.env.HF_TOKEN;
const TOPIC = process.env.TOPIC || "AUTO_RANDOM";

if (!GEMINI_API_KEY || !HF_TOKEN) {
  throw new Error("Missing GEMINI_API_KEY or HF_TOKEN");
}

const OUT = path.join(process.cwd(), "output_up_movement");
fs.mkdirSync(OUT, { recursive: true });

async function gemini(prompt) {
  const models = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3-flash-preview"];
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(url, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.6,maxOutputTokens:900}})
      });
      const bodyText = await r.text();
      if (r.ok) {
        try {
          const d = JSON.parse(bodyText);
          const t = d.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
          if (t) return t;
          console.log("Gemini returned no text from", model, "attempt", attempt);
        } catch (e) {
          console.log("Gemini JSON parse error from", model, "attempt", attempt, bodyText.slice(0,500));
        }
      } else {
        console.log("Gemini", model, "attempt", attempt, "HTTP", r.status, bodyText.slice(0,1000));
      }
      await new Promise(x=>setTimeout(x, Math.min(30000, attempt*10000)));
    }
  }
  throw new Error("Gemini unavailable after trying all configured models");
}

async function image(prompt, file) {
  // Primary: Pollinations image endpoint (free/anonymous where available).
  // Optional POLLINATIONS_API_KEY can raise limits; no key is required by this code.
  const encoded = encodeURIComponent(prompt.slice(0,1800));
  const pollUrl = `https://image.pollinations.ai/prompt/${encoded}?width=768&height=1365&nologo=true&model=flux`;
  for (let attempt=1; attempt<=2; attempt++) {
    try {
      const headers = POLLINATIONS_API_KEY
        ? {Authorization:`Bearer ${POLLINATIONS_API_KEY}`}
        : {};
      const r = await fetch(pollUrl,{headers,signal:AbortSignal.timeout(120000)});
      const ct=r.headers.get("content-type")||"";
      if (r.ok && ct.startsWith("image/")) {
        fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));
        console.log("Image provider: Pollinations");
        return;
      }
      console.log("Pollinations attempt",attempt,"HTTP",r.status,(await r.text()).slice(0,300));
    } catch(e) {
      console.log("Pollinations attempt",attempt,"error",e.message);
    }
    await new Promise(x=>setTimeout(x,15000));
  }

  // Secondary: Cloudflare FLUX when its daily neuron quota is available.
  if (CF_TOKEN && CF_ACCOUNT) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    const r = await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${CF_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({prompt:prompt.slice(0,2000)})});
    if (!r.ok) throw new Error("Image generation failed: Pollinations unavailable; Cloudflare FLUX "+r.status+" "+await r.text());
    const ct=r.headers.get("content-type")||"";
    if (ct.includes("application/json")) {
      const d=await r.json();
      if (!d.result?.image) throw new Error("Cloudflare FLUX returned no image");
      fs.writeFileSync(file,Buffer.from(d.result.image,"base64"));
    } else fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));
    console.log("Image provider: Cloudflare FLUX fallback");
    return;
  }

  throw new Error("Image generation failed: Pollinations unavailable and Cloudflare credentials are not configured");
}

function motion(imagePath,prompt,outPath){
  const py=`
import sys, shutil
from gradio_client import Client, handle_file
img,prompt,out=sys.argv[1],sys.argv[2],sys.argv[3]
client=Client("zerogpu-aoti/wan2-2-fp8da-aoti-faster", token=sys.argv[4])
result=client.predict(handle_file(img), prompt[:1200], 4, "", 4.0, 1.0, 1.0, 42, True, api_name="/generate_video")
p=result[0] if isinstance(result,(list,tuple)) else result
if isinstance(p,dict): p=p.get("path") or p.get("url")
if not p: raise RuntimeError(str(result))
shutil.copyfile(p,out)
`;
  fs.writeFileSync("/tmp/up_motion.py",py);
  execFileSync("python",["/tmp/up_motion.py",imagePath,prompt,outPath,HF_TOKEN],{stdio:"inherit"});
}

function ff(args){execFileSync("ffmpeg",["-y",...args],{stdio:"inherit"});}

(async()=>{
  const runKey = process.env.GITHUB_RUN_ID || String(Date.now());
  const autoMode = !TOPIC || TOPIC === "AUTO_RANDOM";
  const archetypes = [
    "extreme water-slide POV with a hidden drop or unexpected exit",
    "rooftop-to-street camera dive with a safe-looking path that suddenly changes",
    "giant tunnel or pipe traversal with an unexpected opening at the end",
    "roller-coaster or amusement-ride POV with a sudden visual reveal",
    "mountain or cliff-path POV where the route suddenly disappears and reveals a safe hidden passage",
    "underwater tunnel POV with a surprise object or creature-like visual reveal",
    "warehouse or industrial-machine POV with moving obstacles and a last-second reveal",
    "forest trail POV where the camera rushes toward an apparently blocked path that opens unexpectedly",
    "giant slide, chute or spiral structure with a surprising final landing",
    "street-level POV chasing a moving object that suddenly changes direction into a hidden space",
    "bridge or cable-structure POV with a dramatic drop and unexpected safe platform",
    "giant transparent tube or glass walkway with a sudden perspective illusion",
    "sports or stunt POV with a fast approach followed by an unexpected visual payoff",
    "theme-park attraction POV with a fake dead end followed by a sudden reveal",
    "giant architectural structure where the camera enters a tiny opening and emerges somewhere surprising",
    "cinematic escape-route POV with doors, turns and a final unexpected reveal",
    "high-altitude POV diving toward a structure and discovering a hidden interior",
    "giant ball or object rolling toward camera with a last-second perspective twist",
    "construction-site POV with cranes, platforms and a sudden downward movement",
    "mysterious real-world location POV built around scale, depth and one strong surprise"
  ];
  const archetype = archetypes[Number(runKey.replace(/\\D/g,"").slice(-4) || "0") % archetypes.length];

  const master=`Create ONE completely new viral short-video concept for this run.
Run key: ${runKey}
Preferred archetype: ${archetype}
${autoMode ? "Choose the exact subject/location yourself. Do NOT reuse a generic hand/object reveal." : `User topic constraint: "${TOPIC}"`}

REFERENCE STYLE:
The reference is a realistic vertical POV/cinematic action video: a person/camera approaches a physical situation, commits to the movement, the camera travels rapidly through real space with strong depth, then an unexpected visual event/reveal happens and a human reaction or payoff lands at the end.
The feeling should be "wait... what?!", not a normal slideshow.

CORE RULES:
- Every run must be a DIFFERENT scenario, location, action and surprise.
- Do not make all videos about hands, objects, tubes, drops or the same stunt; vary the concept.
- The first 2-3 seconds must create curiosity.
- Build tension and spatial movement continuously.
- Around 12-17 seconds, deliver the main surprise/OHPS moment.
- End with a clear payoff/reaction/reveal.
- The camera must physically move through the scene: approach, dive, follow, pass, turn, fall, rise or squeeze through space.
- No static shots, no simple digital zoom, no slideshow, no fake camera shake.
- Photorealistic live-action look, believable physics, natural lighting, realistic people/anatomy.
- Keep one coherent location and subject across all five scenes.
- Make it plausible enough to feel like a real viral phone/cinematic video, while the surprise can be visually extraordinary.
- Avoid dangerous instructions or imitation guidance; this is visual storytelling only.

Return exactly 5 lines, labeled S1 through S5.
S1 = curiosity/setup: establish the strange situation and start moving.
S2 = commitment: camera moves deeper/faster and raises tension.
S3 = escalation: movement becomes visually intense and the audience thinks they know what will happen.
S4 = SURPRISE/OHPS MOMENT: reveal the unexpected event, perspective or transformation.
S5 = payoff: camera reaches/reframes the result and captures a believable reaction or final reveal.

Do not include narration, captions, logos, UI, watermarks, readable text, split screens or collages.`;
  const raw=await gemini(master);
  const lines=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const scenes=[];
  for(let i=1;i<=5;i++){
    const found=lines.find(x=>new RegExp("^S"+i+"\\s*:","i").test(x));
    scenes.push((found?found.replace(new RegExp("^S"+i+"\\s*:\s*","i"),""):lines[i-1]||"").trim());
  }
  fs.writeFileSync(path.join(OUT,"scene_prompts.txt"),scenes.map((s,i)=>`S${i+1}: ${s}`).join("\n\n"));

  const clips=[];
  for(let i=0;i<5;i++){
    const ip=path.join(OUT,`scene_${i+1}.png`);
    const vp=path.join(OUT,`motion_${i+1}.mp4`);
    const sp=`Photorealistic vertical 9:16 cinematic frame. Scene description: ${scenes[i]} Main subject clear and composed for a vertical 9:16 crop, realistic anatomy and materials, strong foreground/midground/background depth, natural dramatic lighting, premium live-action film look, believable physics, no text, no logos, no watermark.`;
    console.log("Generating image",i+1);
    await image(sp,ip);
    const clip=`/tmp/up_${i+1}.mp4`;
    if (i === 3) {
      console.log("Generating AI motion for S4 OHPS scene only (free-mode: 1 ZeroGPU call)");
      motion(ip,scenes[i],vp);
      ff(["-stream_loop","-1","-i",vp,"-t","4","-vf","scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p","-an","-c:v","libx264","-preset","veryfast","-crf","20",clip]);
    } else {
      console.log("Generating cinematic camera movement for S"+(i+1)+" with FFmpeg (no GPU)");
      const moves = [
        "scale=2600:4622:force_original_aspect_ratio=increase,crop=1080:1920:x='(in_w-out_w)*0.50':y='(in_h-out_h)*(0.03+0.42*t/4)',fps=30,format=yuv420p",
        "scale=2600:4622:force_original_aspect_ratio=increase,crop=1080:1920:x='(in_w-out_w)*(0.46+0.12*t/4)':y='(in_h-out_h)*(0.28+0.45*t/4)',fps=30,format=yuv420p",
        "scale=2600:4622:force_original_aspect_ratio=increase,crop=1080:1920:x='(in_w-out_w)*(0.05+0.75*t/4)':y='(in_h-out_h)*(0.10+0.45*t/4)',fps=30,format=yuv420p",
        "scale=2600:4622:force_original_aspect_ratio=increase,crop=1080:1920:x='(in_w-out_w)*(0.62-0.22*t/4)':y='(in_h-out_h)*(0.38-0.20*t/4)',fps=30,format=yuv420p"
      ];
      ff(["-loop","1","-i",ip,"-t","4","-vf",moves[i < 3 ? i : 3],"-an","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p",clip]);
    }
    clips.push(clip);
  }

  const list="/tmp/up_concat.txt";
  fs.writeFileSync(list,clips.map(x=>`file '${x}'`).join("\n")+"\n");
  const final=path.join(OUT,"up_movement_reel_20s.mp4");
  ff(["-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",final]);
  fs.writeFileSync(path.join(OUT,"topic.txt"),TOPIC);
  console.log("DONE:",final);
})().catch(e=>{console.error(e);process.exit(1);});
