export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const body=req.body||{};
    const subject=String(body.subject||'').trim().slice(0,300);
    const message=String(body.message||'').trim().slice(0,6000);
    const history=Array.isArray(body.history)?body.history.slice(-12).map(x=>({role:x&&x.role==='assistant'?'assistant':'user',content:String(x&&x.content||'').slice(0,4000)})).filter(x=>x.content):[];
    if(!message) return res.status(400).json({error:'Please describe the problem first.'});
    const token=process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN;
    if(!token) return res.status(503).json({error:'Customer Care AI is not configured yet.'});
    const system=[
      'You are the official Artist Level Up Customer Care AI Agent.',
      'Your job is to help Artist Level Up users solve app problems clearly, safely and step by step.',
      'You know this app includes artist and user accounts, registration, login, Global Feed, uploads, songs/beats, video uploads, Studio, Beat Marketplace, Paystack payments, downloads, privacy settings and cloud saving/sync.',
      'Be practical: identify the likely feature, ask for the exact on-screen message when needed, give one or two concrete checks at a time, and explain what the user should tap next.',
      'Use the user’s wording and Nigerian English/Pidgin naturally when helpful, but remain clear and professional.',
      'Never ask for or request passwords, PINs, OTPs, card numbers, secret keys, recovery codes or other credentials.',
      'Never claim that you changed code, accessed an account, checked a database, processed a payment, or performed an action unless a real tool in this request actually did it.',
      'If the problem needs an app-side code fix or staff intervention, say so clearly and gather the exact error/message and steps that caused it.',
      'For cloud messages such as “Saved on this device · Cloud will retry”, distinguish local saving from cloud synchronization and ask what type of item is affected before giving targeted steps.',
      'For payment issues, do not request card details; ask for a transaction/reference number only if the user is comfortable sharing a non-secret reference.',
      'Do not invent app buttons or settings. If you are unsure a control exists, say that and ask what the user currently sees.',
      'Keep answers concise but useful. Do not dump a long checklist unless the user asks for detailed steps.'
    ].join(' ');
    const input=[{role:'system',content:system},...history,{role:'user',content:(subject?'Subject: '+subject+'\n':'')+message}];
    const r=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({model:'openai/gpt-5.4',messages:input,max_tokens:1200,reasoning_effort:'medium'})
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){const detail=data?.error?.message||data?.error||('Gateway request failed ('+r.status+')');return res.status(502).json({error:String(detail).slice(0,500)});}
    const reply=data?.choices?.[0]?.message?.content;
    if(!reply) return res.status(502).json({error:'The AI returned no reply.'});
    return res.status(200).json({reply});
  }catch(err){return res.status(500).json({error:String(err?.message||err).slice(0,500)});}
}