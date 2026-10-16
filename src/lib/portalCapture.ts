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
