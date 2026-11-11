package cn.syc.trafficqa;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Small online client. System speech services are used; no Google SDK is bundled. */
public final class MainActivity extends Activity {
  private static final String ORIGIN="https://traffic-smart-qa.onrender.com";
  private static final int MICROPHONE_PERMISSION=41;
  private static final int LOCATION_PERMISSION=42;
  private final Handler main=new Handler(Looper.getMainLooper());
  private WebView web;
  private LinearLayout errorPanel;
  private TextView errorText;
  private WebMessagePort port;
  private SpeechRecognizer recognizer;
  private TextToSpeech speaker;
  private String recognitionId="",pendingRecognitionId="",speechId="",pageToken="";
  private boolean foreground=false,ttsReady=false,ttsFailed=false,destroyed=false,loadFailed=false;
  private long lastTouch=0;
  private long speechSessionUntil=0;
  private LocationManager locationManager;
  private LocationListener locationListener;
  private Location bestLocation;
  private String locationId="",pendingLocationId="";

  private static boolean trusted(String value) {
    return UrlPolicy.trusted(value);
  }
  private boolean connected(){return !destroyed&&port!=null&&trusted(web.getUrl());}
  private boolean recentTouch(){return lastTouch>0&&SystemClock.elapsedRealtime()-lastTouch<3500;}

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(245,247,250));
    root.setFitsSystemWindows(true);setContentView(root);
    web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
    WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSupportMultipleWindows(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setUserAgentString(settings.getUserAgentString()+" TrafficQAAndroid/1.1.0");
    WebView.setWebContentsDebuggingEnabled(false);
    web.setOnTouchListener((view,event)->{if(event.getActionMasked()==MotionEvent.ACTION_UP)lastTouch=SystemClock.elapsedRealtime();return false;});
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return navigate(request.getUrl(),request.hasGesture());}
      @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return navigate(Uri.parse(url),recentTouch());}
      @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){loadFailed=false;disconnect();pageToken=UUID.randomUUID().toString();if(!trusted(url)){view.stopLoading();showError("请从交通智问的正式网址打开。支持的服务地址未发生变更。");}}
      @Override public void onPageCommitVisible(WebView view,String url){if(trusted(url))prepareBridge(pageToken,0);}
      @Override public void onPageFinished(WebView view,String url){if(!loadFailed&&trusted(url)){errorPanel.setVisibility(View.GONE);prepareBridge(pageToken,0);}}
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
        String scheme=request.getUrl().getScheme();
        if(!"https".equalsIgnoreCase(scheme)&&!"data".equalsIgnoreCase(scheme)&&!"blob".equalsIgnoreCase(scheme))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
        return super.shouldInterceptRequest(view,request);
      }
      @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showError("暂时无法连接交通服务。请检查网络，稍后重试；服务器休眠后首次连接可能需要等待。");}
      @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=400)showError("交通服务暂时不可用，请稍后重试。");}
      @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();showError("无法验证网站的安全连接，请检查设备时间和网络后重试。");}
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
      @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean userGesture,Message result){
        if(!userGesture)return false;
        WebView popup=new WebView(MainActivity.this);
        popup.setWebViewClient(new WebViewClient(){
          @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(trusted(request.getUrl().toString()))web.loadUrl(request.getUrl().toString());else navigate(request.getUrl(),true);view.destroy();return true;}
          @Override public boolean shouldOverrideUrlLoading(WebView view,String url){if(trusted(url))web.loadUrl(url);else navigate(Uri.parse(url),true);view.destroy();return true;}
        });
        ((WebView.WebViewTransport)result.obj).setWebView(popup);result.sendToTarget();return true;
      }
    });
    web.setDownloadListener((url,agent,disposition,mime,size)->openBrowser(Uri.parse(url)));
    errorPanel=new LinearLayout(this);errorPanel.setOrientation(LinearLayout.VERTICAL);errorPanel.setGravity(Gravity.CENTER);errorPanel.setPadding(36,36,36,36);errorPanel.setBackgroundColor(Color.rgb(245,247,250));
    errorText=new TextView(this);errorText.setTextColor(Color.rgb(39,68,99));errorText.setTextSize(16);errorText.setGravity(Gravity.CENTER);errorPanel.addView(errorText);
    Button retry=new Button(this);retry.setText("重新连接交通智问");retry.setOnClickListener(v->{errorPanel.setVisibility(View.GONE);web.loadUrl(ORIGIN+"/?source=android");});errorPanel.addView(retry);
    root.addView(errorPanel,new FrameLayout.LayoutParams(-1,-1));errorPanel.setVisibility(View.GONE);
    speaker=new TextToSpeech(this,status->{ttsReady=status==TextToSpeech.SUCCESS;ttsFailed=!ttsReady;});
    speaker.setOnUtteranceProgressListener(new UtteranceProgressListener(){
      @Override public void onStart(String id){emit("tts-start",id,null,null);}
      @Override public void onDone(String id){if(id.equals(speechId))speechId="";emit("tts-end",id,null,null);}
      @Override public void onError(String id){emit("tts-error",id,"synthesis-failed",null);}
      @Override public void onError(String id,int error){onError(id);}
    });
    web.loadUrl(ORIGIN+"/?source=android");
  }
  private boolean navigate(Uri uri,boolean userGesture){
    if(trusted(uri.toString()))return false;
    if(userGesture&&"https".equalsIgnoreCase(uri.getScheme()))openBrowser(uri);
    return true;
  }
  private void openBrowser(Uri uri){
    if(!"https".equalsIgnoreCase(uri.getScheme()))return;
    try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){Toast.makeText(this,"未找到可打开此链接的浏览器",Toast.LENGTH_SHORT).show();}
  }
  private void showError(String text){runOnUiThread(()->{if(!destroyed){loadFailed=true;disconnect();errorText.setText(text);errorPanel.setVisibility(View.VISIBLE);}});}
  private void prepareBridge(String token,int attempts){
    if(destroyed||loadFailed||!token.equals(pageToken)||!trusted(web.getUrl())||port!=null||attempts>=150)return;
    web.evaluateJavascript("!!window.TrafficAndroidVoice",result->{if(!token.equals(pageToken)||port!=null)return;if("true".equals(result))connectPage();else main.postDelayed(()->prepareBridge(token,attempts+1),200);});
  }
  private void connectPage(){
    if(port!=null||pageToken.isEmpty()||loadFailed)return;
    WebMessagePort[] channel=web.createWebMessageChannel();port=channel[0];
    port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort ignored,WebMessage message){handleMessage(message.getData());}},main);
    final String token=pageToken;
    web.evaluateJavascript("window.__trafficNativeToken="+JSONObject.quote(token)+";",ignored->{
      if(connected()&&token.equals(pageToken))web.postWebMessage(new WebMessage("traffic-native-v1:"+token,new WebMessagePort[]{channel[1]}),Uri.parse(ORIGIN));
    });
  }
  private void disconnect(){
    pageToken="";pendingRecognitionId="";pendingLocationId="";stopRecognition(false);stopSpeech();stopLocation();
    if(port!=null){try{port.close();}catch(Exception ignored){}port=null;}
  }
  private void emit(String type,String id,String error,String text){
    main.post(()->{
      if(!connected())return;
      try{JSONObject message=new JSONObject();message.put("type",type);message.put("id",id);if(error!=null)message.put("error",error);if(text!=null)message.put("text",text);port.postMessage(new WebMessage(message.toString()));}catch(Exception ignored){}
    });
  }
  private void handleMessage(String raw){
    if(!connected()||raw==null||raw.length()>10000)return;
    try{
      JSONObject message=new JSONObject(raw);String type=message.optString("type"),id=message.optString("id");
      if(id.length()>80||!id.matches("[A-Za-z0-9_-]*"))return;
      switch(type){
        case "speech-start":
          if(!foreground||!recentTouch()){emit("speech-error",id,"not-allowed",null);return;}
          stopSpeech();stopRecognition(false);
          if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){pendingRecognitionId=id;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MICROPHONE_PERMISSION);}else beginRecognition(id);
          break;
        case "speech-stop":if(id.equals(recognitionId)&&recognizer!=null)recognizer.stopListening();break;
        case "speech-abort":if(id.equals(recognitionId)||id.equals(pendingRecognitionId)){pendingRecognitionId="";stopRecognition(false);}break;
        case "tts-speak":
          String text=message.optString("text");if(text.length()>2000)return;
          // Later segments are allowed only while a user-started reading session is active.
          if(!foreground||(!recentTouch()&&SystemClock.elapsedRealtime()>speechSessionUntil)){emit("tts-error",id,"not-allowed",null);return;}
          speechSessionUntil=SystemClock.elapsedRealtime()+120000;
          speak(id,text,(float)message.optDouble("rate",1),pageToken,0);break;
        case "tts-cancel":stopSpeech();break;
        case "tts-end-session":speechSessionUntil=0;break;
        case "location-get":
          if(!foreground||!recentTouch()){locationError(id,1);return;}
          stopLocation();
          if(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){pendingLocationId=id;requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION},LOCATION_PERMISSION);}else beginLocation(id);
          break;
        case "location-cancel":if(id.equals(locationId)||id.equals(pendingLocationId)){pendingLocationId="";stopLocation();}break;
        default:break;
      }
    }catch(Exception ignored){}
  }
  private void beginRecognition(String id){
    if(!foreground||!connected())return;
    if(!SpeechRecognizer.isRecognitionAvailable(this)){emit("speech-error",id,"service-not-allowed",null);return;}
    try{
      recognitionId=id;recognizer=SpeechRecognizer.createSpeechRecognizer(this);
      recognizer.setRecognitionListener(new RecognitionListener(){
        private boolean current(){return id.equals(recognitionId);}
        @Override public void onReadyForSpeech(Bundle p){if(current())emit("speech-start",id,null,null);}
        @Override public void onBeginningOfSpeech(){}
        @Override public void onRmsChanged(float rms){}
        @Override public void onBufferReceived(byte[] buffer){}
        @Override public void onEndOfSpeech(){}
        @Override public void onError(int error){if(!current())return;String reason=error==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS?"not-allowed":error==SpeechRecognizer.ERROR_NO_MATCH||error==SpeechRecognizer.ERROR_SPEECH_TIMEOUT?"no-speech":error==SpeechRecognizer.ERROR_NETWORK||error==SpeechRecognizer.ERROR_NETWORK_TIMEOUT?"network":"audio-capture";emit("speech-error",id,reason,null);stopRecognition(false);}
        private void result(Bundle bundle,boolean last){if(!current())return;ArrayList<String> values=bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);if(values!=null&&!values.isEmpty())emit(last?"speech-result":"speech-partial",id,null,values.get(0));if(last){emit("speech-end",id,null,null);stopRecognition(false);}}
        @Override public void onResults(Bundle bundle){result(bundle,true);}
        @Override public void onPartialResults(Bundle bundle){result(bundle,false);}
        @Override public void onEvent(int type,Bundle params){}
      });
      Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"zh-CN");intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true);intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);recognizer.startListening(intent);
      main.postDelayed(()->{if(id.equals(recognitionId)){emit("speech-end",id,null,null);stopRecognition(false);}},45000);
    }catch(Exception error){emit("speech-error",id,"audio-capture",null);stopRecognition(false);}
  }
  private void stopRecognition(boolean notify){
    String id=recognitionId;recognitionId="";
    if(recognizer!=null){try{recognizer.cancel();recognizer.destroy();}catch(Exception ignored){}recognizer=null;}
    if(notify&&!id.isEmpty())emit("speech-end",id,null,null);
  }
  @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){
    super.onRequestPermissionsResult(request,permissions,grants);
    if(request==MICROPHONE_PERMISSION){String id=pendingRecognitionId;pendingRecognitionId="";if(id.isEmpty())return;if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED&&foreground&&connected())beginRecognition(id);else emit("speech-error",id,"not-allowed",null);}
    if(request==LOCATION_PERMISSION){String id=pendingLocationId;pendingLocationId="";if(id.isEmpty())return;if(foreground&&connected()&&(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED))beginLocation(id);else locationError(id,1);}
  }
  private void beginLocation(String id){
    if(!foreground||!connected())return;
    try{
      locationManager=(LocationManager)getSystemService(LOCATION_SERVICE);locationId=id;bestLocation=null;
      boolean fine=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
      ArrayList<String> providers=new ArrayList<>();
      if(locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))providers.add(LocationManager.NETWORK_PROVIDER);
      if(fine&&locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))providers.add(LocationManager.GPS_PROVIDER);
      if(providers.isEmpty()){locationError(id,2);stopLocation();return;}
      locationListener=new LocationListener(){
        @Override public void onLocationChanged(Location value){
          if(!id.equals(locationId)||System.currentTimeMillis()-value.getTime()>120000)return;
          if(bestLocation==null||value.getAccuracy()<bestLocation.getAccuracy())bestLocation=value;
          if(value.hasAccuracy()&&value.getAccuracy()<=1500)finishLocation(id,value);
        }
        @Override public void onStatusChanged(String provider,int status,Bundle extra){}
        @Override public void onProviderEnabled(String provider){}
        @Override public void onProviderDisabled(String provider){}
      };
      for(String provider:providers){
        try{Location last=locationManager.getLastKnownLocation(provider);if(last!=null&&System.currentTimeMillis()-last.getTime()<=120000&&last.hasAccuracy()&&last.getAccuracy()<=1500){finishLocation(id,last);return;}}catch(SecurityException ignored){}
        try{locationManager.requestLocationUpdates(provider,0,0,locationListener,Looper.getMainLooper());}catch(SecurityException ignored){}
      }
      main.postDelayed(()->{if(id.equals(locationId)){if(bestLocation!=null)finishLocation(id,bestLocation);else{locationError(id,3);stopLocation();}}},20000);
    }catch(Exception ignored){locationError(id,2);stopLocation();}
  }
  private void finishLocation(String id,Location value){
    final double latitude=value.getLatitude(),longitude=value.getLongitude(),accuracy=value.hasAccuracy()?value.getAccuracy():100000;
    stopLocation();
    main.post(()->{if(!connected()||!foreground)return;try{JSONObject message=new JSONObject();message.put("type","location-result");message.put("id",id);message.put("latitude",latitude);message.put("longitude",longitude);message.put("accuracy",accuracy);message.put("timestamp",value.getTime());port.postMessage(new WebMessage(message.toString()));}catch(Exception ignored){}});
  }
  private void locationError(String id,int code){main.post(()->{if(!connected())return;try{JSONObject message=new JSONObject();message.put("type","location-error");message.put("id",id);message.put("code",code);port.postMessage(new WebMessage(message.toString()));}catch(Exception ignored){}});}
  private void stopLocation(){locationId="";bestLocation=null;if(locationManager!=null&&locationListener!=null){try{locationManager.removeUpdates(locationListener);}catch(Exception ignored){}}locationListener=null;}
  private void speak(String id,String text,float rate,String token,int attempts){
    if(!token.equals(pageToken)||!connected()||!foreground)return;
    if(attempts>0&&!id.equals(speechId))return;
    if(!ttsReady){if(!ttsFailed&&attempts<20){speechId=id;main.postDelayed(()->speak(id,text,rate,token,attempts+1),100);return;}emit("tts-error",id,"synthesis-unavailable",null);speechId="";return;}
    stopRecognition(true);
    int language=speaker.setLanguage(Locale.SIMPLIFIED_CHINESE);
    if(language==TextToSpeech.LANG_MISSING_DATA||language==TextToSpeech.LANG_NOT_SUPPORTED){emit("tts-error",id,"language-not-supported",null);speechId="";return;}
    speechId=id;speaker.setSpeechRate(Math.max(.5f,Math.min(1.5f,rate)));
    if(speaker.speak(text,TextToSpeech.QUEUE_FLUSH,null,id)==TextToSpeech.ERROR){speechId="";emit("tts-error",id,"synthesis-failed",null);}
  }
  private void stopSpeech(){speechId="";speechSessionUntil=0;if(speaker!=null)speaker.stop();}
  @Override protected void onStart(){super.onStart();foreground=true;}
  @Override protected void onStop(){foreground=false;pendingRecognitionId="";pendingLocationId="";if(!locationId.isEmpty())locationError(locationId,2);stopLocation();stopRecognition(true);stopSpeech();CookieManager.getInstance().flush();super.onStop();}
  @Override public void onBackPressed(){
    web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true;}return false;})()",result->{if(!"true".equals(result)){if(web.canGoBack())web.goBack();else moveTaskToBack(true);}});
  }
  @Override protected void onDestroy(){destroyed=true;disconnect();if(speaker!=null)speaker.shutdown();if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
