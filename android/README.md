# 交通智问 Android / 华为兼容鸿蒙安装包

此客户端适用于可安装安卓 APK 的鸿蒙系统、Android 6.0（API 23）及以上系统，不是鸿蒙 NEXT 原生应用，也未声称通过华为应用市场审核。APK 不依赖 Google Play Services、Google 登录或专有地图 SDK。它通过系统 WebView 访问既有 HTTPS 服务，保留数据问答、线网图和换乘功能；需要联网，资料、模型和地图密钥继续留在服务端。

## 构建与升级

运行 `py scripts/build_android.py`，需要 JDK、Android 35 的 android.jar 和 Android 35 Build Tools；脚本默认从被忽略的 `outputs/android-toolchain/` 寻找，也可用脚本中注明的环境变量指定工具文件。当前工具取自 Android 官方仓库与 Eclipse Temurin 官方发行包，下载大小和校验值保存在本机 `outputs/android-toolchain/downloads.json`。不使用 Gradle、第三方 Android 库或运行时下载代码编译器。

脚本执行 Java 编译、D8、资源打包、zipalign、APK v1/v2/v3 签名与验证，输出 `public/downloads/traffic-smart-qa-1.0.0.apk` 和不含私钥的 `public/android-release.json`。发布前后均核对 SHA-256、签名指纹与版本信息。后续升级需要提高 AndroidManifest 的 versionCode 与构建脚本版本，并在网站构建路由中加入对应的新安装包。

**保留本机 `outputs/android-signing/` 中的发布签名文件和凭据，后续更新必须沿用同一个签名身份。** 此目录被 Git 忽略并限制为当前用户与 SYSTEM 访问；密码仅通过子进程环境变量传入签名工具。不要上传该目录、私钥或密码到公开仓库、下载页或云环境。新的构建电脑需要安全迁移原签名目录，不能重新生成另一个同包名签名替换现有安装包。

## 系统语音和访问边界

原生语音通过 Android 的 SpeechRecognizer 和 TextToSpeech 使用设备默认系统服务，不指定或绑定 Google 服务。语音识别服务是否可用、是否支持普通话、是否联网以及系统中文音色取决于用户手机；没有可调用的识别服务时，保留手机键盘语音输入方式。应用仅声明联网、麦克风两项权限，在用户点击语音输入后申请麦克风，停止或切后台后释放识别器，不持有录音文件。

原生通信通过只转交给 `https://traffic-smart-qa.onrender.com` 主页面的 MessagePort，未使用 addJavascriptInterface。网页响应禁止嵌套 iframe；导航校验 scheme、host、port 和 userinfo，外部 HTTPS 来源链接交给浏览器，证书错误直接取消。录音需要前台状态、最近触摸和运行时授权，迟到回调不会恢复旧输入。朗读长文本按网页分段处理，取消后不会补播延迟任务。

构建时运行 15 个网址边界用例，网页测试验证原生端口协议与取消、签名 APK 的下载 MIME / 附件名 / 哈希和原有功能。尚未在用户提供的华为真机上安装或测试语音服务；编译与签名验证不能替代真机兼容性验证。
