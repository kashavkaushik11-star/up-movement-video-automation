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
    "underwater discovery: a real diver approaches a dark crack in the seabed and discovers a complete submerged city with lights still glowing",
    "abandoned metro discovery: a real person walks beside an old railway tunnel and the camera dives into a hidden station where a train is still moving",
    "mountain mystery: a real climber reaches a rock wall and a narrow opening reveals a massive underground world behind it",
    "desert secret: a real traveler crosses empty dunes and the camera drops into a buried ancient city hidden beneath the sand",
    "forest mystery: a real hiker follows strange lights through dense forest and discovers a huge modern structure hidden underground",
    "frozen-world reveal: a real explorer walks across a glacier and a crack opens into a vast illuminated chamber beneath the ice",
    "ocean cliff reveal: a real diver swims toward a cliff and the camera passes through a natural opening into a gigantic hidden cavern",
    "rooftop mystery: a real person runs across rooftops and the camera follows them into a doorway that reveals an impossible giant interior space",
    "old-house mystery: a real person enters an abandoned house and the camera moves through a wall opening into a huge forgotten underground facility",
    "waterfall secret: a real hiker approaches a waterfall and the camera passes behind it to reveal a hidden illuminated settlement",
    "bridge discovery: a real person crosses a huge bridge and the camera dives below it to reveal an entire hidden city built underneath",
    "cave discovery: a real explorer enters a normal cave and the camera reveals that the cave continues into a giant underground road system",
    "construction-site mystery: a real worker notices movement below a construction pit and the camera dives down to reveal a forgotten structure",
    "jungle temple reveal: a real explorer follows a narrow jungle path and discovers a gigantic ancient complex hidden behind vegetation",
    "storm escape: a real person moves through heavy rain toward shelter and the camera enters the shelter to reveal a vast underground world",
    "lake mystery: a real diver enters a quiet lake and discovers a fully intact room with lights, furniture and a mysterious doorway",
    "city manhole mystery: a real person opens an ordinary street access door and the camera dives down into an enormous hidden tunnel network",
    "cliffside house reveal: a real person approaches a remote house on a cliff and the camera reveals a huge structure carved inside the mountain",
    "snow village mystery: a real traveler walks through an empty snowy village and discovers warm lights coming from a giant underground settlement",
    "real-world impossible scale: a real human enters an ordinary location and the camera progressively reveals a much larger hidden environment than expected"
  ];
  const archetype = archetypes[Number(runKey.replace(/\\D/g,"").slice(-4) || "0") % archetypes.length];

  const master=`Create ONE highly watchable viral cinematic short concept for this run.
Run key: ${runKey}
Preferred concept: ${archetype}
${autoMode ? "Choose the exact subject/location yourself. The MAIN SUBJECT MUST BE A REAL HUMAN." : `User topic constraint: "${TOPIC}"`}

CORE GOAL:
The viewer must think "WAIT... WHAT IS THAT?" and keep watching for the reveal.
This must feel like a real human filmed in a real location with a moving physical camera.
Do NOT make a generic action montage. Build one mystery and reveal it.

STORY FORMULA:
HOOK (0-3s) -> APPROACH (3-8s) -> SUSPICION (8-12s) -> BIG REVEAL (12-16s) -> CLIFFHANGER (16-20s).

S1 (0-4s): Start with a striking but believable real-world scene. A real human is clearly visible doing one simple action. The camera starts high/distant and rapidly moves toward the human. Show one strange visual clue that creates a question.
S2 (4-8s): Camera physically follows the SAME human deeper into the location. Reveal a second clue that makes the viewer suspect something hidden. Strong parallax and changing perspective.
S3 (8-12s): The camera gets close to the human and follows their movement. The human notices something unexpected. Build tension immediately before the reveal. Do NOT reveal the answer yet.
S4 (12-16s): BIG OHPS REVEAL. The camera suddenly passes around/through a physical opening or obstruction and reveals a huge unexpected environment or spatial discovery. The reveal must be visually obvious and dramatically larger/different than what came before.
S5 (16-20s): Do NOT explain the reveal. Push/orbit toward the same human as they react naturally, then expose one final clue or moving silhouette/object in the revealed environment. End at the moment that creates a question for the next video.

HUMAN:
- One realistic human is the main character.
- Keep human visible and important, not a tiny background figure.
- Natural face, skin, hands, body proportions, hair and clothing.
- Same identity and clothing across all five scenes.
- Human performs believable actions and reacts naturally.
- No CGI character, robot, statue or cartoon.

LOCATION:
- One coherent real-world location.
- Same time of day and lighting direction.
- Use foreground, midground and background depth.
- The reveal must physically exist in the same world.

CAMERA:
- Real physical camera language: drone dive, crane descent, tracking, orbit, pass-through, whip-pan, push-in, low fly-through.
- Camera must physically change viewpoint and uncover new information.
- Strong parallax, realistic motion blur, natural lens behavior.
- Never use a static shot or simple digital zoom as the main movement.

REVEAL RULES:
- The reveal must be BIG, clear and understandable within one second.
- Prefer discoveries such as a hidden city, enormous underground chamber, submerged building, secret station, giant structure, hidden road, or impossible scale change that still looks physically filmed.
- Avoid random monsters, floating CGI objects, giant hands, abstract shapes and meaningless explosions.
- The surprise should come from SPACE and DISCOVERY, not cheap visual effects.

STYLE:
Photorealistic live-action, premium cinematic photography, realistic human skin, realistic materials, believable physics, dramatic natural lighting, vertical 9:16, viral short-form pacing.
No text, captions, logos, UI, watermark, collage or split screen.

Return EXACTLY 5 lines labeled S1, S2, S3, S4, S5.
Each line must include HUMAN + LOCATION + ACTION + CAMERA MOVEMENT + the new clue/reveal.
No narration or dialogue.`;

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
    const sp=`Photorealistic LIVE-ACTION vertical 9:16 frame from a viral cinematic mystery film.
Scene: ${scenes[i]}

IMPORTANT:
- MAIN SUBJECT = one real human person, clearly visible and physically integrated into the scene.
- Keep the SAME human identity, approximate face, hairstyle, clothing and body appearance across all scenes.
- Real-world location with strong foreground, midground and background depth.
- Make the environment visually interesting and large enough to support a dramatic camera reveal.
- The scene must contain the exact clue/reveal described in the scene line.
- Make the reveal visually obvious, not subtle or abstract.
- Natural human anatomy, realistic skin, hands, clothing and lighting.
- Photorealistic live-action, premium cinema camera, realistic lens, realistic shadows, believable physics.
- No cartoon, no CGI-looking human, no robot, no statue, no giant hands, no random monster, no text, no logo, no watermark, no split screen.`;

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
