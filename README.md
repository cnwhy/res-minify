自动压缩合并js css, express中间件

demo:  
```
var resminify = require("res-minify")
app.use(resminify(path.join(__dirname, 'public')));
app.use("/v2",resminify(path.join(__dirname, 'public'),{"reAbsolute":true}));
```

##API resminify(path,options)
*path* 物理路径
*options* 配置
```js
//defined
{
    "compressCSS": true     //css压缩
    ,"reAbsolute": false    //是否转换CSS中原有的绝对路径 (当路由不是根路径时,将原CSS根路径的URL加上当前路由;
    ,"compressJS": true     //js压缩
    ,"serverCache":true     //服务器缓存
    ,"fileMaxAge":604800    //浏览器缓存时间
    ,"cacheFilePaths": ""   //缓存目录 不设置则缓存到内存
    ,"directoryList":false  //目录浏览
    ,"defaultFile":["index.html","index.htm","default.html","default.htm"]  //默认文件,开启目录浏览后失效;
}
```

*自动合并访问规则*
http:/XXX/js/??a.js,b.js  
http:/XXX/css/??a.css,b.css
