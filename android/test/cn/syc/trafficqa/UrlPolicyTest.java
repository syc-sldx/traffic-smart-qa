package cn.syc.trafficqa;

public final class UrlPolicyTest {
  public static void main(String[] args) {
    String[] allowed={"https://traffic-smart-qa.onrender.com/","https://traffic-smart-qa.onrender.com:443/?q=station","https://TRAFFIC-SMART-QA.ONRENDER.COM/reports/example"};
    String[] blocked={null,"http://traffic-smart-qa.onrender.com/","https://traffic-smart-qa.onrender.com.evil.test/","https://traffic-smart-qa.onrender.com@evil.test/","https://evil@traffic-smart-qa.onrender.com/","https://traffic-smart-qa.onrender.com:8443/","javascript:alert(1)","file:///sdcard/page.html","data:text/html,test","https://traffic-smart-qa.onrender.com./","https://traffic-smart-qa.onrender.com\\@evil.test/","https://%74raffic-smart-qa.onrender.com/"};
    for(String url:allowed)if(!UrlPolicy.trusted(url))throw new AssertionError("Unexpected rejection: "+url);
    for(String url:blocked)if(UrlPolicy.trusted(url))throw new AssertionError("Unexpected trusted origin: "+url);
    System.out.println("Android origin boundary: 15 cases passed");
  }
}
