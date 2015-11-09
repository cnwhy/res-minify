自动压缩合并js css, express中间件

demo:  
```
var resminify = require("res-minify")
app.use(resminify(path.join(__dirname, 'public')))
```

*自动合并访问规则*  
http:/XXX/js/??a.js,b.js  
http:/XXX/css/??a.css,b.css
