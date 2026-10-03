from pathlib import Path
import re

p=Path("index.html")
s=p.read_text(encoding="utf-8")

old_css=r"#globalDiscoveryFeedV77 .g77-item{position:relative;height:100svh;min-height:100vh;width:100%;scroll-snap-align:start;background:#000;overflow:hidden}\n#globalDiscoveryFeedV77"
new_css="#globalDiscoveryFeedV77 .g77-item{position:relative;height:100svh;min-height:100vh;width:100%;scroll-snap-align:start;background:#000;overflow:hidden}\n#globalDiscoveryFeedV77"
if old_css in s:
    s=s.replace(old_css,new_css,1)

pattern=r"async function open77\(\)\{.*?\n\}\nfunction close77\(\)"
replacement="""async function open77(){
 root.classList.add('active');root.setAttribute('aria-hidden','false');document.body.classList.add('g77-open');soundBtn.textContent=muted?'🔇':'🔊';
 track.innerHTML='<div class="g77-empty"><div><div style="font-size:34px;margin-bottom:12px">🌍</div><b>Global Feed</b><div style="opacity:.7;margin-top:8px">Loading published videos and approved pictures…</div></div></div>';
 setTimeout(autoplayVisible,80);
 Promise.resolve().then(async()=>{
   try{await Promise.race([render77(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('Global feed render timed out')),4500))])}
   catch(e){console.warn('Global feed render skipped:',e);if(root.classList.contains('active'))track.innerHTML='<div class="g77-empty"><div><div style="font-size:34px;margin-bottom:12px">🌍</div><b>Global Feed is ready</b><div style="opacity:.7;margin-top:8px">Published videos and approved pictures will appear here.</div></div></div>'}
   try{if(typeof window.ALU_REFRESH_VIDEOS==='function')await Promise.race([window.ALU_REFRESH_VIDEOS(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('Video refresh timed out')),4000))])}catch(e){console.warn('Global video refresh skipped:',e)}
   try{await syncLocalApprovedPictures();await Promise.race([render77(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('Global feed refresh timed out')),4500))])}catch(e){console.warn('Global picture refresh skipped:',e)}
 });
}
function close77()"""
s2,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1:
    raise SystemExit("Global Feed open77 block not found")
p.write_text(s2,encoding="utf-8")
print("patched")
