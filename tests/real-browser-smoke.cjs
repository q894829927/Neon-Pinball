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
              pendingRound:{multiplier:8,lit:[3,5]},
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
      if(profile.name==="desktop"||profile.name==="phone"){
        const sound=page.locator("#soundBtn");
        assert.equal(await sound.getAttribute("aria-pressed"),"false");
        await sound.click();
        assert.equal(await sound.getAttribute("aria-pressed"),"true");
        assert.equal(await sound.getAttribute("aria-label"),"关闭音效");
        await sound.click();
        assert.equal(await sound.getAttribute("aria-pressed"),"false");
        assert.equal(await sound.getAttribute("aria-label"),"开启音效");
      }
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
      const outlets=await page.evaluate(()=>{
        const rect=(id)=>document.getElementById(id).getBoundingClientRect();
        const ticket=rect("ticketDispenser"),hopper=rect("marbleHopper"),
          board=rect("board"),basin=rect("payoutBasin");
        return {ticket:ticket.toJSON(),hopper:hopper.toJSON(),
          board:board.toJSON(),basin:basin.toJSON(),
          popup:document.querySelector("#shootOverlay")!==null};
      });
      assert.equal(outlets.popup,false,"No full-screen result modal");
      assert.ok(outlets.ticket.right<outlets.hopper.left+2,"Ticket exit is left of input slot");
      assert.ok(Math.abs(outlets.ticket.top-outlets.hopper.top)<15,"Ticket exit shares hopper row");
      assert.ok(outlets.basin.top>=outlets.board.bottom-1,"The payout bowl is below the pinball field");
      assert.ok(outlets.basin.width>20&&outlets.basin.height>=16,"Visible physical payout bowl");
      if(profile.name==="desktop"||profile.name==="phone"){
        const trayPhysics=await page.evaluate(async()=>{
          const {makeTrayBall,stepTrayBalls,isBallInTray}=await import(
            "/games/pinball/payout-tray.mjs?v=0.10.1");
          const container=document.getElementById("payoutBasin");
          const track=document.getElementById("payoutCoins");
          const width=track.clientWidth,height=track.clientHeight;
          const balls=[],nodes=[];
          for(let tick=0;tick<210;tick++){
            if(tick%5===0&&balls.length<20){
              balls.push(makeTrayBall(balls.length,width,height));
              const node=document.createElement("span");
              node.className="dispensed-marble";
              track.append(node);nodes.push(node);
            }
            stepTrayBalls(balls,1/60,width,height);
            for(let i=0;i<balls.length;i++){
              const b=balls[i];
              if(!isBallInTray(b,width,height))return {ok:false,reason:"Model escaped",ball:b};
              nodes[i].style.transform="translate3d("+(b.x-b.radius)+"px,"+
                (b.y-b.radius)+"px,0)";
            }
          }
          const basin=container.getBoundingClientRect();
          const safe=nodes.every(node=>{
            const bounds=node.getBoundingClientRect();
            return bounds.left>=basin.left-1&&bounds.right<=basin.right+1&&
              bounds.top>=basin.top-1&&bounds.bottom<=basin.bottom+1;
          });
          nodes.forEach(node=>node.remove());
          return {ok:safe,balls:balls.length,width,height};
        });
        assert.equal(trayPhysics.balls,20);
        assert.equal(trayPhysics.ok,true,"All physically simulated marbles are inside the visible basin");
        console.log("PAYOUT-TRAY "+profile.name+" "+JSON.stringify(trayPhysics));
      }
      const button=profile.name.startsWith("desktop")||profile.name==="landscape"
        ?page.locator('.side-left [data-add="1"]')
        :page.locator('.mobile-playbar [data-add="1"]');
      await button.click({timeout:6000});
      const expectedStake=profile.name.startsWith("desktop")?"17":"1";
      assert.equal(await page.locator("#mobileStake").textContent(),expectedStake);
      if(profile.name==="desktop"){
        // A genuine launch must finish by touching the physical bottom floor.
        // This catches a shot stuck forever in the new guide/collision system.
        // Keep audio enabled for the real physical shot: exercise collision
        // synthesis in Chromium, not only the toggle's startup beep.
        await page.locator("#soundBtn").click();
        assert.equal(await page.locator("#soundBtn").getAttribute("aria-pressed"),"true");
        await page.evaluate(()=>document.activeElement?.blur?.());
        await page.keyboard.down("Space");
        await page.waitForTimeout(680);
        await page.keyboard.up("Space");
        await page.waitForFunction(
          ()=>!document.querySelector("#inlineResult").hidden,
          null,{timeout:28000});
        const result=await page.locator("#resultDetail").textContent();
        assert.equal(await page.locator("#payoutStage").getAttribute("data-act"),"result",
          "Four-act sequence resolves inside the cabinet, without a popup");
        assert.ok(await page.locator("#payoutSkip").count()===1,
          "Four-act ceremony offers an explicit skip control");
        const winPresentation=await page.evaluate(()=>{
          const machine=document.querySelector("#payoutStage");
          const banner=document.querySelector("#jackpotBanner");
          return {big:machine.classList.contains("is-big-win"),
            bannerVisible:!banner.hidden,
            win:document.querySelector("#resultTitle").textContent.includes("命中")};
        });
        assert.equal(winPresentation.big,winPresentation.bannerVisible,
          "Jackpot banner and special overlay must be synchronized");
        assert.ok(!winPresentation.big||winPresentation.win,"Big win is only available after a hit");
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
        assert.ok(layout.machine.width>100&&layout.machine.width<=layout.hud.width+2,"Proportional cabinet fits HUD width");
        assert.ok(layout.scrollWidth<=layout.viewportWidth+2,"No horizontal scrolling");
        assert.ok(layout.scrollHeight<=profile.height+2,"No vertical page scrolling");
        assert.match(layout.touchAction,/manipulation/,"Touch-action manipulation on game UI");
        assert.equal(layout.canvasTouchAction,"none","Plunger gestures must work");
        const geometry=await page.evaluate(()=>{
          const canvas=document.querySelector("#board").getBoundingClientRect();
          const power=document.querySelector(".launch-console").getBoundingClientRect();
          return {canvas:canvas.toJSON(),powerBottom:power.bottom,viewport:window.innerHeight};
        });
        console.log("PHONE-CANVAS "+profile.name+" "+JSON.stringify(geometry));
        assert.ok(geometry.canvas.height>180,"Playing field cannot collapse vertically");
        assert.ok(Math.abs(geometry.canvas.width/geometry.canvas.height-420/710)<.02,
          "Restore original steel-pin and ball shape without stretching");
        assert.ok(geometry.powerBottom<=geometry.viewport+2,"Bottom slots and power bar always visible");
        // Two quick taps on an inert marquee must not change visualViewport.zoom.
        const title=page.locator(".cabinet-logo");
        const center=await title.boundingBox();
        if(center){
          const x=center.x+center.width/2,y=center.y+center.height/2;
          await page.touchscreen.tap(x,y);
          await page.touchscreen.tap(x,y);
          const zoom=await page.evaluate(()=>window.visualViewport?.scale??1);
          assert.ok(Math.abs(zoom-1)<.01,"Double-tap must not zoom the game");
        }
      }
      await ctx.close();
    }
  }finally{await browser.close()}
})().catch(err=>{console.error("REAL BROWSER FAILED:",err.stack||err);process.exitCode=1});
