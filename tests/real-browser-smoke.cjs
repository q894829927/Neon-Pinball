/* Actual headless Chromium smoke check for Canvas + UI, not mocked DOM. */
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try{
    const profiles=[
      {name:"desktop",width:1728,height:928,deviceScaleFactor:1},
      {name:"phone",width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},
      {name:"small-phone",width:320,height:620,deviceScaleFactor:2,isMobile:true,hasTouch:true},
      {name:"landscape",width:844,height:390,deviceScaleFactor:2,isMobile:true,hasTouch:true},
    ];
    for(const profile of profiles){
      const ctx=await browser.newContext(profile);
      const page=await ctx.newPage();
      const errors=[],failures=[];
      page.on("pageerror",error=>errors.push(error.stack||String(error)));
      page.on("requestfailed",req=>failures.push(req.url()+": "+req.failure()?.errorText));
      const response=await page.goto("http://127.0.0.1:8766/games/pinball/",{waitUntil:"networkidle",timeout:25000});
      assert.equal(response.status(),200);
      await page.waitForTimeout(1200);
      const evidence=await page.evaluate(()=>{
        const canvas=document.querySelector("#board");
        const rect=canvas.getBoundingClientRect();
        const ctx=canvas.getContext("2d");
        const pixels=[[10,10],[100,200],[200,300],[55,680]].map(([x,y])=>{
          const p=ctx.getImageData(Math.floor(x*canvas.width/420),Math.floor(y*canvas.height/710),1,1).data;
          return [...p];
        });
        const nodes=["#board",".cabinet",".machine-section","#launchStatus","#stakeAmount"].map(s=>({
          selector:s,display:getComputedStyle(document.querySelector(s)).display,
          rect:document.querySelector(s).getBoundingClientRect().toJSON(),
        }));
        return {pixels,nodes,canvasWidth:canvas.width,canvasHeight:canvas.height,
          viewport:{width:window.innerWidth,height:window.innerHeight},
          scrollHeight:document.documentElement.scrollHeight,
          status:document.querySelector("#launchStatus").textContent,
          version:document.querySelector(".game-version")?.textContent,
        };
      });
      console.log("BROWSER "+profile.name+" "+JSON.stringify({errors,failures,evidence}));
      await page.screenshot({path:"/tmp/pinball-"+profile.name+".png",fullPage:true});
      assert.deepEqual(errors,[],"JavaScript runtime errors ("+profile.name+")");
      assert.deepEqual(failures,[],"Missing static resources ("+profile.name+")");
      assert.ok(evidence.pixels.some(p=>p[0]>2||p[1]>2||p[2]>2),"The game canvas is still black!");
      assert.ok(evidence.canvasWidth>0&&evidence.canvasHeight>0);
      const button=page.locator('[data-add="1"]').last();
      await button.click();
      assert.equal(await page.locator("#mobileStake").textContent(),"1");
      if(profile.name==="desktop"||profile.name==="phone")
        assert.ok(evidence.scrollHeight<=profile.height+2,"Unexpected vertical page scrolling");
      await ctx.close();
    }
  }finally{await browser.close()}
})().catch(err=>{console.error("REAL BROWSER FAILED:",err.stack||err);process.exitCode=1});
