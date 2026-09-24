const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || "";
const HF_TOKEN = process.env.HF_TOKEN;
const TOPIC = process.env.TOPIC || "AUTO_RANDOM";

if (!GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY");
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
${autoMode ? "Choose the exact subject/location yourself. The MAIN SUBJECT MUST BE A REALISTIC HUMAN PERSON." : `User topic constraint: "${TOPIC}"`}

REFERENCE VIDEO STYLE — FOLLOW THIS CLOSELY:
Create the feeling of a real filmed viral action/cinematic video, not an AI slideshow.
A real human is the continuous MAIN SUBJECT in one coherent real-world location.
The camera starts from a high or distant position, then physically travels toward and around the human with strong depth and parallax: aerial dive, descending move, forward tracking, passing close to foreground objects, orbiting, push-in, or controlled approach.
The human must visibly exist in the scene and perform a simple believable action or react naturally.
The visual surprise comes from what the CAMERA discovers in the environment, not from replacing the human with a CGI object.
The entire sequence should feel like one continuous real camera journey.

20-SECOND STRUCTURE:
S1 (0-4s) = HIGH/DISTANT ESTABLISHING SHOT. Real human clearly visible in the environment. Camera begins above/behind/distant and starts moving toward the human. Create immediate curiosity.
S2 (4-8s) = DESCENDING APPROACH. Camera rapidly descends/advances toward the same human. Strong foreground/midground/background parallax. Human action continues naturally.
S3 (8-12s) = CLOSE TRACKING/COMMITMENT. Camera gets much closer, passes through or around the environment while tracking the same human. Tension increases and the viewer expects one obvious outcome.
S4 (12-16s) = OHPS SURPRISE. Camera suddenly reveals an unexpected real-world spatial event directly around/in front of the human. Keep the same human, location, lighting and physical continuity. This is the strongest visual moment.
S5 (16-20s) = PAYOFF. Camera completes the move with a controlled push-in/orbit/reframe toward the same human and captures a believable human reaction or final reveal.

HUMAN CONTINUITY:
- One main human throughout all 5 scenes.
- Photorealistic live-action human, natural skin, face, hair, hands, body proportions and clothing.
- Keep the person's identity, clothing and appearance consistent across S1-S5.
- Human must be clearly visible in at least S1, S2, S3 and S5.
- Do not make the human a tiny background figure.
- Do not turn the human into an object, statue, robot or CGI character.
- Natural body movement and believable interaction with the environment.

CAMERA:
- Physical camera movement only: drone dive, crane descent, tracking, orbit, pass-by, push-in, rise or fall.
- Strong depth/parallax and realistic motion blur.
- No static composition, no slideshow feeling, no simple digital zoom, no fake shake.
- Camera movement must change perspective and reveal new spatial information.

VISUAL QUALITY:
- Photorealistic live-action, premium cinematic photography.
- Real-world location, realistic materials, natural dramatic lighting, believable physics.
- Vertical 9:16 composition.
- No text, captions, logos, UI, watermark, collage or split screen.
- No generic abstract tunnels, floating objects, giant hands, or fantasy CGI unless the surprise specifically requires a believable real-world element.

Return exactly 5 lines, labeled S1 through S5.
Each line must describe: HUMAN + LOCATION + ACTION + CAMERA MOVEMENT + what is visible/revealed.
Do not write narration or dialogue.`;
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
    const sp=`Photorealistic LIVE-ACTION vertical 9:16 cinematic frame. Scene description: ${scenes[i]} IMPORTANT: the MAIN SUBJECT is a real human person, clearly visible, natural human face, realistic skin, realistic hands, realistic anatomy, natural body posture and believable clothing. Keep the SAME human appearance, hairstyle, clothing and identity across every scene. Real-world location, real physical environment, strong foreground/midground/background depth, natural dramatic lighting, realistic shadows, premium Hollywood live-action camera look, believable physics. The human must be integrated into the environment, not a CGI character. No giant objects as the main subject, no abstract shapes, no fantasy tunnel, no robot, no cartoon, no text, no logos, no watermark.`;
    console.log("Generating image",i+1);
    await image(sp,ip);
    const clip=`/tmp/up_${i+1}.mp4`;
    if (i === 3 && HF_TOKEN) {
      console.log("Trying AI motion for S4 OHPS scene (1 ZeroGPU call).");
      try {
        motion(ip,scenes[i],vp);
        ff(["-stream_loop","-1","-i",vp,"-t","4","-vf","scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p","-an","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p",clip]);
        console.log("S4 AI motion succeeded.");
      } catch (e) {
        console.log("S4 AI motion unavailable; using cinematic fallback so the run still completes.");
        console.log(String(e.message || e).slice(0,500));
        ff(["-loop","1","-i",ip,"-t","4","-vf","scale=2600:4622:force_original_aspect_ratio=increase,crop=1080:1920:x='(in_w-out_w)*(0.62-0.22*t/4)':y='(in_h-out_h)*(0.38-0.20*t/4)',fps=30,format=yuv420p","-an","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p",clip]);
      }
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
