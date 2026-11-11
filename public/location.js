(()=>{
  'use strict';
  const get=id=>document.getElementById(id);let current=null,generation=0,cancel=null;
  function clear(){generation++;cancel?.();cancel=null;current=null;get('location-origin').hidden=true;get('location-clear').hidden=true;get('location-status').textContent='仅在点击后获取；定位坐标不写入账号记忆。';get('locate').disabled=false;}
  function valid(){return current&&Date.now()-current.located_at<600000&&current.route_usable;}
  get('location-clear').onclick=clear;
  get('locate').onclick=async()=>{
    const token=++generation;cancel?.();cancel=null;current=null;get('locate').disabled=true;get('location-origin').hidden=true;get('location-status').textContent='正在定位，请在设备询问时允许位置权限…';
    try{
      if(/TrafficQAAndroid\//.test(navigator.userAgent)&&!window.TrafficAndroidLocation)throw new Error('当前安装包还不支持定位，请下载并覆盖安装1.1.0版 APK。');
      const provider=window.TrafficAndroidLocation||navigator.geolocation;
      if(!provider||!window.isSecureContext)throw new Error('当前环境不支持安全定位，请使用手机系统浏览器或新版 App，也可手动填写城市。');
      const position=await new Promise((resolve,reject)=>{
        const value=provider.getCurrentPosition(resolve,error=>reject(new Error(error.code===1?'位置权限未获允许，请在系统设置中授权，或手动填写城市。':error.code===3?'定位超时，请到信号较好的位置重试。':'未能取得位置，请检查系统定位服务或手动填写城市。')),{enableHighAccuracy:true,timeout:20000,maximumAge:120000});
        if(typeof value==='function')cancel=value;
      });
      if(token!==generation)return;
      get('location-status').textContent='正在识别所在城市…';
      const response=await fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy})});const data=await response.json();
      if(token!==generation)return;if(!response.ok)throw new Error(data.error||'暂时无法识别城市。');
      current=data;get('city').value=data.city;get('city').dispatchEvent(new Event('change',{bubbles:true}));
      get('location-status').textContent='本次定位：'+data.city+data.district+' · 精度约'+Math.round(data.accuracy)+'米'+(data.route_usable?'':'，请手动填写更准确的路线起点。');
      get('location-origin').hidden=!data.route_usable;get('location-clear').hidden=false;
    }catch(error){if(token===generation){get('location-status').textContent=error.message;get('location-clear').hidden=false;}}
    finally{if(token===generation)get('locate').disabled=false;}
  };
  get('location-origin').onclick=()=>{
    if(!valid()){get('location-status').textContent='定位已过期或精度不足，请重新定位后设置起点。';return;}
    window.TrafficChat.setMode('travel');get('action').value='route';get('action').dispatchEvent(new Event('change',{bubbles:true}));get('city').value=current.city;get('origin').value='当前位置';get('destination').focus();
  };
  window.TrafficLocation={clear,
    details(text=''){
      if(!/^(?:当前位置|我的位置)$/.test(get('origin').value)&&!/(?:当前|我的)位置/.test(text))return {};
      if(!valid())return {};
      return {city:current.city,origin:'当前位置',origin_location:current.location,action:'route',transport:get('transport').value||'transit'};
    }
  };
  window.addEventListener('pagehide',()=>{generation++;cancel?.();});
})();
