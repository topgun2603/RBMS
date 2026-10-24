/**
 * First paint in a shop's colours for the back-office apps (no "use client": the apps' root layouts, which are server
 * components, render the script; lib/branding.tsx writes the cache).
 *
 * ShopProvider loads GET /v1/branding after mount, so without this the default indigo showed until it returned. It
 * stores the shop's transformed branding <style> text (adminBrandingCss) under `sr-brand-css:<slug>`; this inline
 * <head> script puts the last one back before first paint. The shop is the subdomain ("raja.localhost" → raja), else,
 * on a bare host (localhost, an IP), the stored shop (`sr_tenant`). ShopProvider removes it once the live <style> is in.
 */

/** localStorage key prefix of the cached branding <style> text, per shop slug (not `sr_`: no session listeners). */
export const BRANDING_CACHE_PREFIX = "sr-brand-css:";
/** id of the <style> the boot script adds. */
export const BRANDING_BOOT_ID = "sr-branding-boot";
/** Larger CSS isn't cached (localStorage is small and shared). */
export const MAX_CACHED_BRANDING_CSS = 20_000;

const key = JSON.stringify(BRANDING_CACHE_PREFIX);
const id = JSON.stringify(BRANDING_BOOT_ID);

export const BRANDING_BOOT_SCRIPT = [
  "try{",
  'var h=location.hostname.split("."),ip=/^[0-9]+$/.test(h[h.length-1]),s=h.length>1&&!ip?h[0]:null;',
  `var c=s?localStorage.getItem(${key}+s):null;`,
  `if(!c&&(h.length<2||ip)){s=localStorage.getItem("sr_tenant");c=s?localStorage.getItem(${key}+s):null}`,
  `if(c&&!document.getElementById(${id})){var e=document.createElement("style");e.id=${id};e.textContent=c;document.head.appendChild(e)}`,
  "}catch(e){}",
].join("");
