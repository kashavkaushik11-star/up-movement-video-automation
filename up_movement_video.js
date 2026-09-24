const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOPIC = process.env.TOPIC || "a mysterious object revealed inside a human hand";

if (!GEMINI_API_KEY || !CF_TOKEN || !CF_ACCOUNT) {
  throw new Error("Missing GEMINI_API_KEY, CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
}

const OUT = path.join(process.cwd(), "output_up_movement");
fs.mkdirSync(OUT, { recursive: true });

async function gemini(prompt) {
  const models = ["gemini-2.5-flash-lite", "gemini-3-flash-preview"];
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(url, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.6,maxOutputTokens:900}})
      });
      if (r.ok) {
        const d = await r.json();
        const t = d.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
        if (t) return t;
      }
      await new Promise(x=>setTimeout(x, attempt*5000));
    }
  }
  throw new Error("Gemini unavailable");
}

async function image(prompt, file) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const r = await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${CF_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({prompt:prompt.slice(0,2000)})});
  if (!r.ok) throw new Error("FLUX "+r.status+" "+await r.text());
  const ct=r.headers.get("content-type")||"";
  if (ct.includes("application/json")) {
    const d=await r.json();
    if (!d.result?.image) throw new Error("FLUX returned no image");
    fs.writeFileSync(file,Buffer.from(d.result.image,"base64"));
  } else fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));
}

function motion(imagePath,prompt,outPath){
  const py=`
import sys, shutil
from gradio_client import Client, handle_file
img,prompt,out=sys.argv[1],sys.argv[2],sys.argv[3]
client=Client("zerogpu-aoti/wan2-2-fp8da-aoti-faster")
result=client.predict(handle_file(img), prompt[:1200], 4, "", 4.0, 1.0, 1.0, 42, True, api_name="/generate_video")
p=result[0] if isinstance(result,(list,tuple)) else result
if isinstance(p,dict): p=p.get("path") or p.get("url")
if not p: raise RuntimeError(str(result))
shutil.copyfile(p,out)
`;
  fs.writeFileSync("/tmp/up_motion.py",py);
  execFileSync("python",["/tmp/up_motion.py",imagePath,prompt,outPath],{stdio:"inherit"});
}

function ff(args){execFileSync("ffmpeg",["-y",...args],{stdio:"inherit"});}

(async()=>{
  const master=`Create a coherent cinematic visual sequence for the subject: "${TOPIC}".
The output is for a vertical 9:16 short video, photorealistic, premium cinematic, strong depth and parallax.
The CAMERA is the star of the shot. It must feel like a real moving camera, not a slideshow.
Use a continuous spatial logic so the five shots can be joined.

Return exactly 5 lines, one scene prompt per line, labeled S1 through S5.
S1: camera begins high above and dives downward toward the environment/subject.
S2: camera continues descending rapidly through foreground layers with strong parallax.
S3: camera reaches the subject and reveals the hidden/main detail as a surprise.
S4: camera pushes closer around the revealed subject with natural motion and depth.
S5: camera makes a final controlled move toward the subject/hand, ending on a strong reveal.
Avoid text, logos, UI, watermarks, fake readable signs, split screens, collage, static camera, simple digital zoom, spinning camera, warped anatomy, extra fingers.
Keep lighting realistic and dramatic. `;
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
    const sp=`Photorealistic vertical 9:16 cinematic frame for "${TOPIC}". ${scenes[i]} Main subject clear and centered enough for vertical crop, realistic anatomy, realistic materials, strong foreground/background depth, natural dramatic lighting, premium film look, no text, no logos, no watermark.`;
    console.log("Generating image",i+1);
    await image(sp,ip);
    console.log("Generating motion",i+1);
    motion(ip,scenes[i],vp);
    const clip=`/tmp/up_${i+1}.mp4`;
    ff(["-stream_loop","-1","-i",vp,"-t","4","-vf","scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p","-an","-c:v","libx264","-preset","veryfast","-crf","20",clip]);
    clips.push(clip);
  }

  const list="/tmp/up_concat.txt";
  fs.writeFileSync(list,clips.map(x=>`file '${x}'`).join("\n")+"\n");
  const final=path.join(OUT,"up_movement_reel_20s.mp4");
  ff(["-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",final]);
  fs.writeFileSync(path.join(OUT,"topic.txt"),TOPIC);
  console.log("DONE:",final);
})().catch(e=>{console.error(e);process.exit(1);});
