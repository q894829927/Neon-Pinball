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
      if(profile.name==="desktop"||profile.name==="phone"){
        await page.locator("#layoutBtn").click();
        await page.locator("#layoutDialog").waitFor({state:"visible"});
        assert.equal(await page.locator("[data-board-layout]").count(),4);
        await page.locator('[data-board-layout="wave"]').click();
        assert.equal(await page.locator('[data-board-layout="wave"]').getAttribute("aria-pressed"),"true");
        assert.equal(await page.locator("#layoutActiveLabel").textContent(),"当前：波浪钉阵");
        const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("neon-pinball-arcade-v1")));
        assert.equal(stored.boardLayout,"wave","Peg choice must survive reload");
        await page.locator("#layoutDialog [data-close='layoutDialog']").click();
        assert.match(await page.locator("#layoutBtn").getAttribute("aria-label"),/波浪钉阵/);
      }

      // v0.10.8 design checks across all existing device profiles.
      const visual=await page.evaluate(()=>{
        const select=query=>document.querySelector(query);
        const rect=query=>select(query).getBoundingClientRect();
        const palette=query=>getComputedStyle(select(query));
        const lamps=[...document.querySelectorAll(".mult-lamp")].map(node=>{
          const b=node.querySelector("b"),small=node.querySelector("small");
          return {bounds:node.getBoundingClientRect().toJSON(),
            value:b.getBoundingClientRect().toJSON(),
            caption:small.getBoundingClientRect().toJSON(),
            background:getComputedStyle(node).backgroundImage};
        });
        const machine=rect(".cabinet"),header=rect(".cabinet-top"),
          lampsFrame=rect(".machine-lamps"),board=rect("#board"),
          payout=rect(".machine-payout");
        const features={
          link:!!select('link[href*="cabinet-v0108.css"]'),
          cabinetBackground:palette(".cabinet").backgroundImage,
          nozzleRadius:palette(".payout-marble-mouth").borderRadius,
          powerRail:palette(".power-track").backgroundImage,
          handleHitbox:rect(".plunger-grip").toJSON(),
          state:select(".machine-section").dataset.pull,
          cabinet:machine.toJSON(),header:header.toJSON(),
          frame:lampsFrame.toJSON(),board:board.toJSON(),payout:payout.toJSON(),
          lamps
        };
        return features;
      });
      assert.ok(visual.link,"New unified design stylesheet must load");
      assert.match(visual.cabinetBackground,/linear-gradient/,"Cabinet chrome is applied");
      assert.match(visual.powerRail,/linear-gradient/,"Plunger force strip is styled");
      assert.equal(visual.lamps.length,5);
      const overlap=await page.evaluate(()=>{
        const measurements=[...document.querySelectorAll(".mult-lamp")].map((lamp,index)=>{
          const big=lamp.querySelector("b").getBoundingClientRect();
          const small=lamp.querySelector("small").getBoundingClientRect();
          const root=lamp.getBoundingClientRect();
          return {index,root:root.toJSON(),big:big.toJSON(),small:small.toJSON()};
        });
        return {measurements,cacheLink:Boolean(document.querySelector('link[href*="performance-v0111.css"]'))};
      });
      assert.ok(overlap.cacheLink,"v0.11.1 lamp/performance stylesheet must load");
      for(const m of overlap.measurements){
        assert.ok(m.big.bottom<=m.small.top+.3,
          "Multiplier overlaps slot-count label: "+JSON.stringify({profile:profile.name,...m}));
        assert.ok(m.big.top>=m.root.top-1&&m.small.bottom<=m.root.bottom+1,
          "Lamp labels must remain inside the socket: "+JSON.stringify({profile:profile.name,...m}));
      }

      assert.equal(visual.state,"idle");
      assert.ok(visual.board.top>=visual.frame.bottom-3);
      assert.ok(visual.payout.top>=visual.board.bottom-1);
      // No new costly layout changes from the optimization layer.
      const pxScale=await page.evaluate(()=>{
        const board=document.querySelector("#board"),rect=board.getBoundingClientRect();
        return {x:board.width/rect.width,y:board.height/rect.height};
      });
      // Canvas never goes below its 420 logical pixels. A tiny fitted
      // cabinet can therefore have a ratio above DPR without oversampling.
      const effectiveCap=Math.max(420/visual.board.width,Math.min(2,profile.deviceScaleFactor));
      assert.ok(pxScale.x<=effectiveCap+.35,
        "Canvas backing resolution exceeds the useful visual pixel budget");

      assert.ok(visual.handleHitbox.width>=30&&visual.handleHitbox.height>=20,
        "Mechanical lever keeps its original responsive touch area");
      for(let n=0;n<visual.lamps.length;n++){
        const lamp=visual.lamps[n],left=visual.frame.left,right=visual.frame.right;
        assert.ok(lamp.bounds.left>=left-2&&lamp.bounds.right<=right+2,
          "Lamp socket "+n+" must not spill outside top metal housing");
        assert.ok(lamp.value.left>=lamp.bounds.left-2&&lamp.value.right<=lamp.bounds.right+2,
          "Multiplier numerals must fit into socket "+n);
        assert.ok(lamp.caption.left>=lamp.bounds.left-2&&lamp.caption.right<=lamp.bounds.right+2,
          "Slot legend must fit into socket "+n);
        if(n)assert.ok(lamp.bounds.left>=visual.lamps[n-1].bounds.right-2,
          "Five multiplier lamps must not overlap one another");
      }

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
      const outletGeometry=await page.evaluate(()=>{
        const hole=document.querySelector(".payout-marble-mouth"),r=hole.getBoundingClientRect();
        const inventory=document.querySelector("#payoutInventory");
        return {width:r.width,height:r.height,borderRadius:getComputedStyle(hole).borderRadius,
          inventoryExists:Boolean(inventory),canvasBox:inventory.getBoundingClientRect().toJSON()};
      });
      assert.ok(Math.abs(outletGeometry.width-outletGeometry.height)<1,"Payout nozzle must be circular");
      assert.ok(outletGeometry.borderRadius.includes("%"),"Metal payout nozzle must have full circular rounding");
      const labelClearance=await page.evaluate(()=>{
        const label=document.querySelector(".payout-receiver-name").getBoundingClientRect();
        const hole=document.querySelector(".payout-marble-mouth").getBoundingClientRect();
        return {clearance:hole.top-label.bottom,diameter:hole.width};
      });
      assert.ok(labelClearance.clearance>=0,"Payout nozzle must not cover its title");
      assert.ok(labelClearance.diameter<=16,"Payout nozzle must be visually small and recessed");
      assert.equal(outletGeometry.inventoryExists,true);
      assert.ok(outletGeometry.canvasBox.width>=16&&outletGeometry.canvasBox.height>=10,
        "Marble canvas must remain visible even in tiny landscape cabinets");
      const platformGeometry=await page.evaluate(()=>{
        const receiver=document.getElementById("payoutReceiver").getBoundingClientRect();
        const bowl=document.getElementById("payoutBasin").getBoundingClientRect();
        const left=document.querySelector(".payout-spill-left").getBoundingClientRect();
        const right=document.querySelector(".payout-spill-right").getBoundingClientRect();
        return {receiver:receiver.toJSON(),bowl:bowl.toJSON(),
          left:left.toJSON(),right:right.toJSON()};
      });
      assert.ok(platformGeometry.left.width>=3&&platformGeometry.right.width>=3,
        "Both spill platforms must be visible at the receiver edges");
      assert.ok(Math.abs(platformGeometry.left.right-platformGeometry.bowl.left)<4,
        "Left steel shelf must touch the glass rim");
      assert.ok(Math.abs(platformGeometry.right.left-platformGeometry.bowl.right)<4,
        "Right steel shelf must touch the glass rim");
      assert.ok(Math.abs(platformGeometry.left.top-(platformGeometry.receiver.bottom-5))<3,
        "Actual platform collision height must match visible shelf");

      // Force both result formats at every viewport, including the 8x/10x
      // special banners. The button must have its own row, never cover digits.
      const summaryCheck=await page.evaluate(()=>{
        const el=id=>document.getElementById(id);
        const panel=el("payoutStage"),summary=el("inlineResult"),
          title=el("resultTitle"),number=el("resultNumber"),
          detail=el("resultDetail"),banner=el("jackpotBanner"),
          card=el("cardEarned"),next=el("nextBtn"),
          heading=el("payoutActLabel"),earning=el("payoutEarnings");
        const previous={
          act:panel.dataset.act,big:panel.classList.contains("is-big-win"),
          summary:summary.hidden,next:next.hidden,heading:heading.hidden,
          earning:earning.hidden,banner:banner.hidden,card:card.hidden,
          title:title.textContent,number:number.innerHTML,
          detail:detail.textContent,bannerText:banner.textContent,
          cardText:card.textContent
        };
        summary.hidden=false;next.hidden=false;heading.hidden=true;
        earning.hidden=true;card.hidden=false;detail.hidden=false;
        panel.dataset.act="result";
        const layouts=[];
        for(const jackpot of [false,true]){
          panel.classList.toggle("is-big-win",jackpot);
          banner.hidden=!jackpot;
          banner.textContent=jackpot?"✦ LEGENDARY 10× ✦":"";
          title.textContent="红灯命中！";
          number.innerHTML="+500 <small>颗</small>";
          detail.textContent="50 颗 × 10 倍 = 500 颗";
          card.textContent="✦ 获得奖励卡 ×10";
          const btn=next.getBoundingClientRect();
          const body=el("payoutStage").querySelector(".payout-status-content").getBoundingClientRect();
          const primary=el("inlineResult").querySelector(".result-primary").getBoundingClientRect();
          const cardRect=card.getBoundingClientRect();
          const bannerRect=banner.getBoundingClientRect();
          const detailRect=detail.getBoundingClientRect();
          layouts.push({jackpot,buttonTop:btn.top,cardBottom:cardRect.bottom,
            bodyTop:body.top,primaryTop:primary.top,primaryBottom:primary.bottom,
            bannerBottom:bannerRect.bottom,detailBottom:detailRect.bottom,
            detailVisible:getComputedStyle(detail).display!=="none"});
        }
        panel.dataset.act=previous.act;
        panel.classList.toggle("is-big-win",previous.big);
        summary.hidden=previous.summary;next.hidden=previous.next;
        heading.hidden=previous.heading;earning.hidden=previous.earning;
        banner.hidden=previous.banner;card.hidden=previous.card;
        title.textContent=previous.title;number.innerHTML=previous.number;
        detail.textContent=previous.detail;banner.textContent=previous.bannerText;
        card.textContent=previous.cardText;
        return layouts;
      });
      for(const layout of summaryCheck){
        assert.ok(layout.cardBottom<=layout.buttonTop+1,
          "Reward-card text must not overlap next-round button: "+JSON.stringify({profile:profile.name,...layout}));
        assert.ok(layout.primaryBottom<=layout.buttonTop+1,
          "Winning amount must be fully above next-round button");
        assert.ok(layout.primaryTop>=layout.bodyTop-1,
          "Result title must remain inside the dedicated summary area");
        if(layout.jackpot)assert.ok(layout.bannerBottom<=layout.primaryTop+1,
          "10× header must not overlap winning title or amount");
        if(layout.detailVisible)assert.ok(layout.detailBottom<=layout.buttonTop+1,
          "Normal win detail must not overlap next-round button");
      }

      if(profile.name==="desktop"||profile.name==="phone"){
        const payoutLayout=await page.evaluate(async()=>{
          const {PAYOUT_RADIUS,createPayoutWorld,stepPayoutWorld,finishPayoutWorld,
            withinPayoutBasin,payoutOverflow}=await import("/games/pinball/payout-physics.mjs?v=0.11.2");
          const tray=document.getElementById("payoutBasin").getBoundingClientRect();
          const receiver=document.getElementById("payoutReceiver").getBoundingClientRect();
          const bounds={left:tray.left-receiver.left,right:tray.right-receiver.left,
            top:tray.top-receiver.top,bottom:tray.bottom-receiver.top};
          const world=createPayoutWorld(receiver.width,receiver.height,500,bounds);
          const before=world.balls.length;
          for(let frame=0;frame<480;frame++)
            stepPayoutWorld(world,1/120,Math.floor(500*(frame+1)/480));
          finishPayoutWorld(world,75);
          const unique=new Set(world.balls.map(p=>p.x.toFixed(2)+"/"+p.y.toFixed(2)));
          return {ok:world.balls.every(p=>withinPayoutBasin(p,world))&&
              unique.size>world.visible*.82&&world.contacts>0&&world.wallHits>=0,
            count:world.balls.length,before,contacts:world.contacts,
            radius:world.radius,radiusFixed:world.radius===PAYOUT_RADIUS,
            overflow:payoutOverflow(world),spilled:world.spilled,
            platformLandings:world.platformLandings,beadImpacts:world.beadImpacts};
        });
        assert.equal(payoutLayout.ok,true,"500 earned credits must show 500 basin beads");
        assert.equal(payoutLayout.count,500);
        assert.ok(payoutLayout.contacts>0,"Real marble contacts must occur");
        assert.equal(payoutLayout.radiusFixed,true,"Reward size must never shrink marble radius");
        assert.ok(payoutLayout.overflow>0,
          "Dense 500-marble payout must visibly overflow the glass lip");
        assert.ok(payoutLayout.beadImpacts>0,
          "Marble-marble physics must produce actual contact impulses");
        const trayPhysics=await page.evaluate(async()=>{
          const {makeTrayBall,stepTrayBalls,isBallInTray}=await import(
            "/games/pinball/payout-tray.mjs?v=0.11.2");
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
      // Verify the full collectible workflow in a real browser. Existing
      // older themes must remain, and equipping never consumes more cards.
      if(profile.name==="desktop"||profile.name==="phone"){
        await page.locator("#giftBtn").click();
        await page.locator("#shopDialog").waitFor({state:"visible"});
        assert.equal(await page.locator('[data-collection-view="album"]').getAttribute("aria-pressed"),"true");
        assert.equal(await page.locator("#giftList .collection-item").count(),12);
        assert.equal(await page.locator("#collectionProgress").textContent(),"0 / 9 已解锁");
        const categoryTabs=await page.locator("[data-collection-category]").count();
        assert.equal(categoryTabs,4);
        await page.locator('[data-collection-category="marble"]').click();
        assert.equal(await page.locator("#giftList .collection-item").count(),4);
        await page.locator('[data-collection-view="shop"]').click();
        assert.equal(await page.locator("#giftList .collection-item").count(),3);
        if(profile.name==="desktop"){
          const initialBalance=await page.locator("#balance").textContent();
          const startCards=Number(await page.locator("#shopCards").textContent());
          await page.locator('[data-item="pearl"] .collection-action').click();
          assert.equal(Number(await page.locator("#shopCards").textContent()),startCards-1);
          assert.equal(await page.locator("#collectionProgress").textContent(),"1 / 9 已解锁");
          assert.equal(await page.locator("#balance").textContent(),initialBalance);
          await page.locator('[data-collection-view="album"]').click();
          assert.equal(await page.locator('[data-item="pearl"] .collection-action').textContent(),"使用中");
          await page.locator('[data-item="steel"] .collection-action').click();
          assert.equal(await page.locator('[data-item="pearl"] .collection-action').textContent(),"装备");
          await page.locator('[data-item="pearl"] .collection-action').click();
          const beforeReload=await page.evaluate(()=>{
            const s=JSON.parse(localStorage.getItem("neon-pinball-arcade-v1"));
            return {cards:s.cards,marbleSkin:s.marbleSkin,theme:s.theme,stake:s.pendingStake};
          });
          assert.equal(beforeReload.marbleSkin,"pearl");
          await page.screenshot({path:"/tmp/pinball-collection-desktop.png",fullPage:true});
          await page.locator("#shopDialog [data-close='shopDialog']").click();
          // The desktop test bootstraps an old save using page.addInitScript.
          // A page.reload would reinsert that old save and mask persistence.
          // A second page in the same browser context shares localStorage,
          // but does not inherit the first page's page-level init script.
          const restoredPage=await ctx.newPage();
          const restoredErrors=[];
          restoredPage.on("pageerror",e=>restoredErrors.push(String(e)));
          await restoredPage.goto("http://127.0.0.1:8766/games/pinball/",{waitUntil:"networkidle"});
          const afterReload=await restoredPage.evaluate(()=>{
            const s=JSON.parse(localStorage.getItem("neon-pinball-arcade-v1"));
            return {cards:s.cards,marbleSkin:s.marbleSkin,theme:s.theme,stake:s.pendingStake};
          });
          assert.deepEqual(restoredErrors,[],"No browser errors after restoring cosmetics");
          assert.deepEqual(afterReload,beforeReload,"Unlocked cosmetics survive a fresh page");
          assert.equal(await restoredPage.locator("#mobileStake").textContent(),String(afterReload.stake));
          await restoredPage.close();
        }else{
          // No purchase, just ensure all category cards and previews remain
          // readable without forcing page scroll on a real touch device.
          const cards=await page.locator("#giftList .collection-item").count();
          assert.equal(cards,3);
          await page.screenshot({path:"/tmp/pinball-collection-phone.png",fullPage:false});
          await page.locator("#shopDialog [data-close='shopDialog']").click();
        }
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
