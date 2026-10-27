/* Actual headless Chromium smoke check for Canvas + UI, not mocked DOM. */
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try{
    const profiles=[
      {name:"desktop",width:1728,height:928,deviceScaleFactor:1},
      {name:"desktop-scaled",width:1440,height:900,deviceScaleFactor:1.25},
      {name:"phone",width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},
      {name:"small-phone",width:320,height:620,deviceScaleFactor:2,isMobile:true,hasTouch:true},
      {name:"landscape",width:844,height:390,deviceScaleFactor:2,isMobile:true,hasTouch:true},
    ];
    for(const profile of profiles){
      const ctx=await browser.newContext({
        viewport:{width:profile.width,height:profile.height},
        deviceScaleFactor:profile.deviceScaleFactor,
        isMobile:Boolean(profile.isMobile),
        hasTouch:Boolean(profile.hasTouch),
      });
      const page=await ctx.newPage();
      if(profile.name.startsWith("desktop")){
        // Mirrors an existing desktop browser, not a clean first-time mobile save.
        // Test an in-progress wager and existing cards/previous rounds.
        await page.addInitScript(()=>{
          try{
            localStorage.setItem("neon-pinball-arcade-v1",JSON.stringify({
              marbles:1034,cards:2,rounds:18,wins:6,best:160,earned:900,
              redeemed:[],theme:"classic",pendingStake:16,
              pendingRound:{multiplier:8,lit:[3]},
            }));
          }catch{}
        });
      }
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
        // Sampling the FIRST steel peg catches the original all-black screen.
        // Merely sampling dark background pixels did not detect that regression.
        const pixels=[[10,10],[48,184],[87,184],[100,200],[200,300],[55,680]].map(([x,y])=>{
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
      assert.ok(Math.max(...evidence.pixels[1].slice(0,3))>110,
        "The first metal peg must be visibly rendered (not just the dark background)");
      if(profile.name.startsWith("desktop")){
        assert.equal(evidence.status,"等待拉杆发射","Saved 16-marble wager must restore correctly");
        assert.ok(evidence.nodes.find(n=>n.selector==="#board").rect.width>280,
          "Desktop cabinet must remain readable");
      }
      assert.ok(evidence.canvasWidth>0&&evidence.canvasHeight>0);
      const button=profile.name.startsWith("desktop")||profile.name==="landscape"
        ?page.locator('.side-left [data-add="1"]')
        :page.locator('.mobile-playbar [data-add="1"]');
      await button.click({timeout:6000});
      const expectedStake=profile.name.startsWith("desktop")?"17":"1";
      assert.equal(await page.locator("#mobileStake").textContent(),expectedStake);
      if(profile.name==="desktop"){
        // A genuine launch must finish by touching the physical bottom floor.
        // This catches a shot stuck forever in the new guide/collision system.
        await page.evaluate(()=>document.activeElement?.blur?.());
        await page.keyboard.down("Space");
        await page.waitForTimeout(680);
        await page.keyboard.up("Space");
        await page.waitForFunction(
          ()=>!document.querySelector("#shootOverlay").hidden,
          null,{timeout:28000});
        const result=await page.locator("#resultDetail").textContent();
        assert.match(result,/颗|槽/);
        assert.deepEqual(errors,[],"No runtime errors after physics settlement");
        await page.screenshot({path:"/tmp/pinball-finished-shot.png",fullPage:true});
      }
      if(profile.name==="desktop")
        assert.ok(evidence.scrollHeight<=profile.height+2,"Desktop unexpectedly scrolls");
      if(profile.name==="phone"||profile.name==="small-phone"){
        const layout=await page.evaluate(()=>{
          const hud=document.querySelector(".mobile-playbar").getBoundingClientRect();
          const machine=document.querySelector(".cabinet").getBoundingClientRect();
          const power=document.querySelector(".launch-console").getBoundingClientRect();
          return {
            hud:{left:hud.left,width:hud.width},
            machine:{left:machine.left,width:machine.width,top:machine.top,bottom:machine.bottom},
            power:{left:power.left,width:power.width,bottom:power.bottom},
            scrollWidth:document.documentElement.scrollWidth,
            scrollHeight:document.documentElement.scrollHeight,
            viewportWidth:window.innerWidth,
            touchAction:getComputedStyle(document.querySelector(".shell")).touchAction,
            canvasTouchAction:getComputedStyle(document.querySelector("#board")).touchAction,
          };
        });
        console.log("PHONE-LAYOUT "+profile.name+" "+JSON.stringify(layout));
        assert.ok(layout.machine.width>=layout.hud.width*.97,"Cabinet must fill the wager bar width");
        assert.ok(Math.abs(layout.machine.left-layout.hud.left)<=3,"Cabinet/HUD left edges must align");
        assert.ok(Math.abs(layout.power.width-layout.hud.width)<=3,"Power bar must match width");
        assert.ok(layout.scrollWidth<=layout.viewportWidth+2,"No horizontal scrolling");
        assert.ok(layout.scrollHeight<=profile.height+2,"No vertical page scrolling");
        assert.match(layout.touchAction,/manipulation/,"Double-tap zoom disabled on game UI");
        assert.equal(layout.canvasTouchAction,"none","Plunger gestures must work");
        const geometry=await page.evaluate(()=>{
          const screen=document.querySelector(".screen-wrap").getBoundingClientRect();
          const canvas=document.querySelector("#board").getBoundingClientRect();
          const power=document.querySelector(".launch-console").getBoundingClientRect();
          return {screen:screen.toJSON(),canvas:canvas.toJSON(),powerBottom:power.bottom,viewport:window.innerHeight};
        });
        console.log("PHONE-CANVAS "+profile.name+" "+JSON.stringify(geometry));
        assert.ok(geometry.canvas.height>180,"Playing field cannot collapse vertically");
        // .screen-wrap has a 2px border on each edge: its content box, not
        // the outer border box, is the actual Canvas painting surface.
        assert.ok(Math.abs(geometry.canvas.height-geometry.screen.height)<=6,"Canvas fills screen content height");
        assert.ok(Math.abs(geometry.canvas.width-geometry.screen.width)<=6,"Canvas fills screen content width");
        assert.ok(geometry.powerBottom<=geometry.viewport+2,"Bottom slots and power bar always visible");
      }
      await ctx.close();
    }
  }finally{await browser.close()}
})().catch(err=>{console.error("REAL BROWSER FAILED:",err.stack||err);process.exitCode=1});
