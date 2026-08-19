const assert = require('assert');

async function runTests() {
  console.log('=== VIDEO FILTERS MODULE CHARACTERIZATION SUITE ===\n');

  const {
    ZOOM_HOOK_PEAK,
    ZOOM_HOOK_DURATION,
    ZOOM_EASE_DURATION,
    ZOOM_KB_BASE,
    ZOOM_KB_RATE,
    ZOOM_KB_MAX,
    buildZoomExpr,
    buildColorGradeFilter,
    buildBrollFilter,
    createVideoFilters
  } = await import('../src/pipeline/videoFilters.js');

  let allPassed = true;

  // -------------------------------------------------------------
  // TEST 1: Frozen Zoom Constants Verification
  // -------------------------------------------------------------
  try {
    assert.strictEqual(ZOOM_HOOK_PEAK, 1.06, 'ZOOM_HOOK_PEAK must equal 1.06');
    assert.strictEqual(ZOOM_HOOK_DURATION, 2.0, 'ZOOM_HOOK_DURATION must equal 2.0');
    assert.strictEqual(ZOOM_EASE_DURATION, 1.0, 'ZOOM_EASE_DURATION must equal 1.0');
    assert.strictEqual(ZOOM_KB_BASE, 1.03, 'ZOOM_KB_BASE must equal 1.03');
    assert.strictEqual(ZOOM_KB_RATE, 0.00015, 'ZOOM_KB_RATE must equal 0.00015');
    assert.strictEqual(ZOOM_KB_MAX, 1.06, 'ZOOM_KB_MAX must equal 1.06');
    console.log('✓ TEST 1 PASSED: Zoom constants match baseline exactly');
  } catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2: Exact Zoom Expression at 15, 30, 60 fps
  // -------------------------------------------------------------
  try {
    const expected15 = 'if(lt(on,30),1.0+on/30*0.0600,if(lt(on,45),1.0600-(on-30)/15*0.0300,min(1.0300+(on-45)*0.000150,1.0600)))';
    const expected30 = 'if(lt(on,60),1.0+on/60*0.0600,if(lt(on,90),1.0600-(on-60)/30*0.0300,min(1.0300+(on-90)*0.000150,1.0600)))';
    const expected60 = 'if(lt(on,120),1.0+on/120*0.0600,if(lt(on,180),1.0600-(on-120)/60*0.0300,min(1.0300+(on-180)*0.000150,1.0600)))';

    assert.strictEqual(buildZoomExpr(15), expected15, 'buildZoomExpr(15) must match exact frozen expression');
    assert.strictEqual(buildZoomExpr(30), expected30, 'buildZoomExpr(30) must match exact frozen expression');
    assert.strictEqual(buildZoomExpr(60), expected60, 'buildZoomExpr(60) must match exact frozen expression');

    console.log('✓ TEST 2 PASSED: buildZoomExpr produces exact frozen expressions at 15, 30, and 60 fps');
  } catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3: Exact Color Grade Filter (Enabled and Disabled)
  // -------------------------------------------------------------
  try {
    const baselineCg = {
      enabled: true,
      brightness: 0.00,
      contrast: 1.10,
      saturation: 1.12,
      gamma: 0.91,
      gammaR: 1.07,
      gammaG: 0.98,
      gammaB: 0.90
    };

    const expectedEnabled = '[composited]eq=brightness=0.000:contrast=1.100:saturation=1.120:gamma=0.910:gamma_r=1.070:gamma_g=0.980:gamma_b=0.900[outv]';
    const expectedDisabled = '[composited]copy[outv]';

    assert.strictEqual(buildColorGradeFilter('[composited]', '[outv]', baselineCg), expectedEnabled, 'Enabled color grade filter must match exact eq parameters');
    assert.strictEqual(buildColorGradeFilter('[composited]', '[outv]', { enabled: false }), expectedDisabled, 'Disabled color grade filter must match exact copy filter');

    console.log('✓ TEST 3 PASSED: buildColorGradeFilter matches exact enabled and disabled strings');
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4: buildBrollFilter with Zero B-Roll Segments
  // -------------------------------------------------------------
  try {
    const baselineCg = {
      enabled: true,
      brightness: 0.00,
      contrast: 1.10,
      saturation: 1.12,
      gamma: 0.91,
      gammaR: 1.07,
      gammaG: 0.98,
      gammaB: 0.90
    };

    const expectedZero = {
      inputs: '',
      filterStr: "[0:v]zoompan=z='if(lt(on,60),1.0+on/60*0.0600,if(lt(on,90),1.0600-(on-60)/30*0.0300,min(1.0300+(on-90)*0.000150,1.0600)))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=30:s=1080x1920[zv];[1:v][zv]scale2ref[ov][base];[base][ov]overlay=0:0[composited];[composited]eq=brightness=0.000:contrast=1.100:saturation=1.120:gamma=0.910:gamma_r=1.070:gamma_g=0.980:gamma_b=0.900[outv]"
    };

    const res = buildBrollFilter([], 1, 1080, 1920, 30, baselineCg);
    assert.strictEqual(typeof res.inputs, 'string', 'res.inputs must be of type string');
    assert.strictEqual(typeof res.filterStr, 'string', 'res.filterStr must be of type string');
    assert.strictEqual(res.inputs, expectedZero.inputs, 'Zero B-roll inputs must be empty string');
    assert.strictEqual(res.filterStr, expectedZero.filterStr, 'Zero B-roll filterStr must match exact frozen graph');

    console.log('✓ TEST 4 PASSED: buildBrollFilter zero segments matches exact return types and strings');
  } catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 5: buildBrollFilter with Single B-Roll Segment
  // -------------------------------------------------------------
  try {
    const baselineCg = {
      enabled: true,
      brightness: 0.00,
      contrast: 1.10,
      saturation: 1.12,
      gamma: 0.91,
      gammaR: 1.07,
      gammaG: 0.98,
      gammaB: 0.90
    };

    const segs = [
      { startTime: 1.5, endTime: 4.5, clipPath: 'assets/Broll/clip1.mp4' }
    ];

    const expectedSingle = {
      inputs: ' -ss 1.0 -t 3.25 -i "assets/Broll/clip1.mp4"',
      filterStr: "[0:v]zoompan=z='if(lt(on,60),1.0+on/60*0.0600,if(lt(on,90),1.0600-(on-60)/30*0.0300,min(1.0300+(on-90)*0.000150,1.0600)))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=30:s=1080x1920[zv];[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS-STARTPTS+1.500/TB[brs0];[zv][brs0]overlay=0:0:enable='between(t,1.500,4.500)'[brv0];[2:v][brv0]scale2ref[ov][base];[base][ov]overlay=0:0[composited];[composited]eq=brightness=0.000:contrast=1.100:saturation=1.120:gamma=0.910:gamma_r=1.070:gamma_g=0.980:gamma_b=0.900[outv]"
    };

    const res = buildBrollFilter(segs, 2, 1080, 1920, 30, baselineCg);
    assert.strictEqual(typeof res.inputs, 'string', 'res.inputs must be a string');
    assert.strictEqual(typeof res.filterStr, 'string', 'res.filterStr must be a string');
    assert.strictEqual(res.inputs, expectedSingle.inputs, 'Single B-roll input command string must match exact frozen string');
    assert.strictEqual(res.filterStr, expectedSingle.filterStr, 'Single B-roll filterStr must match exact frozen filtergraph');

    console.log('✓ TEST 5 PASSED: buildBrollFilter single segment matches exact input and filter strings');
  } catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 6: buildBrollFilter with Multiple B-Roll Segments
  // -------------------------------------------------------------
  try {
    const baselineCg = {
      enabled: true,
      brightness: 0.00,
      contrast: 1.10,
      saturation: 1.12,
      gamma: 0.91,
      gammaR: 1.07,
      gammaG: 0.98,
      gammaB: 0.90
    };

    const segs = [
      { startTime: 1.5, endTime: 3.5, clipPath: 'assets/Broll/clip1.mp4' },
      { startTime: 4.0, endTime: 6.0, clipPath: 'assets/Broll/clip2.mp4' }
    ];

    const expectedMultiple = {
      inputs: ' -ss 1.0 -t 2.25 -i "assets/Broll/clip1.mp4" -ss 1.0 -t 2.25 -i "assets/Broll/clip2.mp4"',
      filterStr: "[0:v]zoompan=z='if(lt(on,60),1.0+on/60*0.0600,if(lt(on,90),1.0600-(on-60)/30*0.0300,min(1.0300+(on-90)*0.000150,1.0600)))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=30:s=1080x1920[zv];[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS-STARTPTS+1.500/TB[brs0];[zv][brs0]overlay=0:0:enable='between(t,1.500,3.500)'[brv0];[2:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS-STARTPTS+4.000/TB[brs1];[brv0][brs1]overlay=0:0:enable='between(t,4.000,6.000)'[brv1];[3:v][brv1]scale2ref[ov][base];[base][ov]overlay=0:0[composited];[composited]eq=brightness=0.000:contrast=1.100:saturation=1.120:gamma=0.910:gamma_r=1.070:gamma_g=0.980:gamma_b=0.900[outv]"
    };

    const res = buildBrollFilter(segs, 3, 1080, 1920, 30, baselineCg);
    assert.strictEqual(typeof res.inputs, 'string', 'res.inputs must be a string');
    assert.strictEqual(typeof res.filterStr, 'string', 'res.filterStr must be a string');
    assert.strictEqual(res.inputs, expectedMultiple.inputs, 'Multiple B-roll inputs command string must match exact frozen string');
    assert.strictEqual(res.filterStr, expectedMultiple.filterStr, 'Multiple B-roll filterStr must match exact frozen filtergraph');

    console.log('✓ TEST 6 PASSED: buildBrollFilter multiple segments matches exact ordering, labels, and formatting');
  } catch (err) {
    console.error('❌ TEST 6 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 7: createVideoFilters Factory Closure Verification
  // -------------------------------------------------------------
  try {
    const baselineCg = {
      enabled: true,
      brightness: 0.00,
      contrast: 1.10,
      saturation: 1.12,
      gamma: 0.91,
      gammaR: 1.07,
      gammaG: 0.98,
      gammaB: 0.90
    };

    const filters = createVideoFilters({ colorGrade: baselineCg });
    assert(typeof filters.buildZoomExpr === 'function', 'buildZoomExpr must be a function');
    assert(typeof filters.buildColorGradeFilter === 'function', 'buildColorGradeFilter must be a function');
    assert(typeof filters.buildBrollFilter === 'function', 'buildBrollFilter must be a function');

    const brollRes = filters.buildBrollFilter([], 1, 1080, 1920, 30);
    assert.strictEqual(typeof brollRes.inputs, 'string', 'factory buildBrollFilter.inputs must be a string');
    assert.strictEqual(typeof brollRes.filterStr, 'string', 'factory buildBrollFilter.filterStr must be a string');
    assert(brollRes.filterStr.includes('brightness=0.000:contrast=1.100'), 'factory must inject colorGrade into buildBrollFilter');

    console.log('✓ TEST 7 PASSED: createVideoFilters factory correctly binds colorGrade and returns bound methods');
  } catch (err) {
    console.error('❌ TEST 7 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // FINAL SUITE RESULT
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  if (allPassed) {
    console.log('✓ ALL VIDEO FILTERS CHARACTERIZATION TESTS PASSED 100%');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED IN VIDEO FILTERS CHARACTERIZATION SUITE');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
