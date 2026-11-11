(()=>{
  'use strict';
  const get=id=>document.getElementById(id),dialog=get('install-dialog');
  const display=matchMedia('(display-mode: standalone)'),fullscreen=matchMedia('(display-mode: fullscreen)');
  const installed=()=>display.matches||fullscreen.matches||navigator.standalone===true;
  let deferredPrompt=null,registration=null,applyingUpdate=false;
  function showInstalled(){
    get('install-app').hidden=installed();
    if(installed())get('install-now').hidden=true;
  }
  function platform(value){
    document.querySelectorAll('[data-install-platform]').forEach(button=>{const selected=button.dataset.installPlatform===value;button.setAttribute('aria-pressed',String(selected));});
    document.querySelectorAll('[data-install-guide]').forEach(guide=>guide.hidden=guide.dataset.installGuide!==value);
  }
  get('install-app').onclick=()=>{
    platform(/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'ios':/Android/.test(navigator.userAgent)?'android':'desktop');
    get('install-result').textContent='';
    get('install-now').hidden=!deferredPrompt;
    dialog.showModal();
  };
  get('install-close').onclick=()=>dialog.close();
  document.querySelectorAll('[data-install-platform]').forEach(button=>button.onclick=()=>platform(button.dataset.installPlatform));
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();deferredPrompt=event;
    if(!installed()){get('install-app').hidden=false;get('install-now').hidden=false;}
  });
  get('install-now').onclick=async()=>{
    if(!deferredPrompt)return;
    const prompt=deferredPrompt;deferredPrompt=null;get('install-now').disabled=true;
    try{
      await prompt.prompt();const choice=await prompt.userChoice;
      get('install-result').textContent=choice.outcome==='accepted'?'已确认安装，请在设备的应用列表或桌面查看交通智问。':'已取消安装，你可以继续使用网页，稍后再从浏览器菜单安装。';
    }catch{get('install-result').textContent='当前浏览器未能打开安装窗口，请按下方步骤从浏览器菜单安装。';}
    finally{get('install-now').hidden=true;get('install-now').disabled=false;}
  };
  window.addEventListener('appinstalled',()=>{
    deferredPrompt=null;get('install-app').hidden=true;get('install-now').hidden=true;
    get('install-result').textContent='交通智问已安装，可以从桌面或应用列表打开。';
  });
  display.addEventListener('change',showInstalled);showInstalled();
  function connection(){
    const offline=navigator.onLine===false;get('offline-notice').hidden=!offline;
    document.body.classList.toggle('is-offline',offline);
    if(offline)get('service-status').textContent='当前离线 · 查询需联网';
    else if(get('service-status').textContent.includes('离线'))get('service-status').textContent='网络已恢复';
  }
  window.addEventListener('offline',connection);window.addEventListener('online',connection);connection();
  function offerUpdate(){get('app-update').hidden=!registration?.waiting;}
  get('app-update-now').onclick=()=>{
    if(!registration?.waiting)return;applyingUpdate=true;get('app-update-now').disabled=true;
    registration.waiting.postMessage({type:'SKIP_WAITING'});
  };
  if('serviceWorker' in navigator&&window.isSecureContext){
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applyingUpdate)location.reload();});
    navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(value=>{
      registration=value;offerUpdate();
      navigator.serviceWorker.ready.then(()=>{get('app-cache-note').textContent='离线界面已准备好。问答、地铁图与实时查询需要联网；安装仍需你在浏览器中确认。';});
      value.addEventListener('updatefound',()=>{
        const worker=value.installing;
        worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offerUpdate();});
      });
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){value.update().catch(()=>{});offerUpdate();}});
    }).catch(()=>{
      get('app-cache-note').textContent='离线页面暂未准备好，请保持联网；你仍可按浏览器提供的方式添加到桌面。';
    });
  }
})();
