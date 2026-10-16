// The "Send to VMS" bookmark (Dana, Oct 16): sends the Worldwide portal page she is looking at to VMS. When the portal
// will not let it send, the page downloads as a file to upload on Settings › Worldwide instead.

/** The bookmark's code, with Dana's private key and VMS's address. */
export function captureBookmarklet(functionsUrl: string, key: string): string {
  const code = `(()=>{const h=document.documentElement.outerHTML;const t=document.title;const u=location.href;` +
    `fetch(${JSON.stringify(`${functionsUrl}/portal-capture`)},{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({key:${JSON.stringify(key)},url:u,title:t,html:h})})` +
    `.then(r=>r.ok?alert('Sent to VMS: '+t):r.text().then(x=>Promise.reject(x)))` +
    `.catch(e=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([h],{type:'text/html'}));a.download='wwd-page.html';document.body.appendChild(a);a.click();` +
    `alert('The portal did not let the page go to VMS ('+e+'). It was saved as wwd-page.html: upload it on VMS Settings > Worldwide.')})})()`
  return `javascript:${encodeURIComponent(code)}`
}

/**
 * "Read all vendors" (Dana, Oct 16: "can it go through this list and click on each one?"): run on the portal's Vendors
 * page, it asks the portal for its vendor list and each vendor's details the way the page itself does (method
 * getVendorData, then selectVendor by vendor number), one at a time, and sends them to VMS 25 at a time. A box on the
 * page shows how far it is. If the portal signs her out it stops and says so.
 */
export function readAllBookmarklet(functionsUrl: string, key: string): string {
  const code = `(async()=>{const API=${JSON.stringify(`${functionsUrl}/portal-capture`)},KEY=${JSON.stringify(key)};` +
    `const m=document.documentElement.innerHTML.match(/p0\\/[^"'\\s<>]*NJportletActionAJAXURL=\\//);` +
    `if(!m){alert('Open the Vendors tab of the Worldwide portal first, then click Read all vendors.');return}` +
    `const url=new URL(m[0].replace(/&amp;/g,'&'),document.baseURI).href;` +
    `const box=document.createElement('div');box.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#14532d;color:#fff;padding:14px 18px;border-radius:12px;font:15px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.35);max-width:320px';document.body.appendChild(box);const say=t=>{box.textContent=t};` +
    `const send=async(source,data)=>{const r=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({key:KEY,source,url:location.href,title:source,html:JSON.stringify(data)})});if(!r.ok)throw new Error('VMS did not take it ('+r.status+')')};` +
    `try{say('Reading the vendor list…');const lr=await fetch(url+'?method=getVendorData',{credentials:'include'});const lt=await lr.text();if(lt.charAt(0)==='<')throw new Error('The portal signed you out. Sign in again and click Read all vendors.');` +
    `const list=JSON.parse(lt);await send('wwd_vendor_list',list);const nums=Object.keys(list.vendors||{});let batch=[],done=0,bad=0;` +
    `for(const n of nums){try{const r=await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'method=selectVendor&vendorNumber='+encodeURIComponent(n)});const t=await r.text();` +
    `if(t.charAt(0)==='<'){if(batch.length)await send('wwd_vendors',batch);say('The portal signed you out after '+done+' vendors. Sign in again and click Read all vendors to start over.');return}` +
    `batch.push({number:n,name:list.vendors[n],detail:JSON.parse(t)})}catch(e){bad++}done++;say('Reading vendors: '+done+' of '+nums.length+'… Leave this page open.');` +
    `if(batch.length>=25){await send('wwd_vendors',batch);batch=[]}await new Promise(z=>setTimeout(z,250))}` +
    `if(batch.length)await send('wwd_vendors',batch);say('Done: '+(done-bad)+' vendors sent to VMS'+(bad?' ('+bad+' could not be read)':'')+'. You can close this page.')}catch(e){say('Stopped: '+(e&&e.message?e.message:e))}})()`
  return `javascript:${encodeURIComponent(code)}`
}
