package cn.syc.trafficqa;

import java.net.URI;

/** Exact origin boundary shared by navigation and the native voice channel. */
final class UrlPolicy {
  static boolean trusted(String value) {
    try {
      URI uri=new URI(value);
      return "https".equalsIgnoreCase(uri.getScheme())&&"traffic-smart-qa.onrender.com".equalsIgnoreCase(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getRawUserInfo()==null;
    } catch(Exception ignored) {return false;}
  }
}
