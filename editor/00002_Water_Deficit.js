// =========================================================================
// ระบบประเมินและติดตามการใช้น้ำชลประทานในพื้นที่เกษตรกรรม ปี 2022
// =========================================================================

// -------------------------------------------------------------------------
// 1. กำหนดพื้นที่ศึกษา (ROI) และตัวแปรเริ่มต้น
// -------------------------------------------------------------------------
var roi = ee.Geometry.Rectangle([
  99.58331572280514,16.509823571011637, 
  100.2753723755851,17.16654821808514]);
  
var year = 2022;
var startDate = year + '-01-01';
var endDate = year + '-04-30'; // ช่วงฤดูแล้ง 4 เดือน

Map.centerObject(roi, 9);

// -------------------------------------------------------------------------
// 2. การสร้างหน้ากากพื้นที่เกษตรกรรมที่เขียวชอุ่ม (Agricultural Mask)
// -------------------------------------------------------------------------
// 2.1 หาค่า NDVI สูงสุดจาก MODIS ในช่วงหน้าแล้ง (พืชที่รอด/เติบโตได้ดี)
var modis_ndvi = ee.ImageCollection("MODIS/061/MOD13A1")
  .filterDate(startDate, endDate)
  .filterBounds(roi)
  .select('NDVI');

// MODIS NDVI ต้องคูณ 0.0001 เพื่อปรับสเกลกลับเป็น -1 ถึง 1
var ndvi_mask = modis_ndvi.max().multiply(0.0001).gt(0.5);

// 2.2 ใช้ ESA WorldCover กรองเฉพาะ "พื้นที่เพาะปลูก" (Class 40 = Cropland)
var worldcover = ee.ImageCollection("ESA/WorldCover/v200").first();
var crop_mask = worldcover.eq(40);

// 2.3 รวมเงื่อนไข: ต้องเป็นพื้นที่เพาะปลูก 'และ' มีความเขียวสูง
var final_mask = ndvi_mask.and(crop_mask);

// -------------------------------------------------------------------------
// 3. คำนวณสมดุลน้ำ (Water Deficit) ช่วงหน้าแล้ง
// -------------------------------------------------------------------------
// 3.1 ข้อมูลการคายน้ำ (ET) จาก MODIS (ตัวคูณสเกล 0.1)
var et_col = ee.ImageCollection("MODIS/006/MOD16A2")
  .filterDate(startDate, endDate)
  .filterBounds(roi)
  .select('ET');
var total_et = et_col.sum().multiply(0.1).clip(roi);

// 3.2 ข้อมูลปริมาณฝน (Precipitation) จาก CHIRPS
var pr_col = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
  .filterDate(startDate, endDate)
  .filterBounds(roi)
  .select('precipitation');
var total_pr = pr_col.sum().clip(roi);

// 3.3 คำนวณ Deficit (ฝน - คายน้ำ) และตัดเฉพาะพื้นที่เกษตร
var dry_season_deficit = total_pr.subtract(total_et)
  .updateMask(final_mask)
  .rename('deficit_2022');

// พิมพ์ค่าสถิติเพื่อดูช่วงข้อมูล
var stats = dry_season_deficit.reduceRegion({
  reducer: ee.Reducer.minMax(),
  geometry: roi,
  scale: 500,
  maxPixels: 1e9
});
print('สถิติ Deficit ฤดูแล้งปี 2022 (มม.):', stats);

// -------------------------------------------------------------------------
// 4. คำนวณพื้นที่เชิงปริมาณ (Area Calculation)
// -------------------------------------------------------------------------
// กำหนดเกณฑ์: Deficit < -50 มม. คือโซนที่พึ่งพาน้ำชลประทานสูง
var high_irrigation_mask = dry_season_deficit.lt(-50);

var area_m2 = ee.Image.pixelArea()
  .updateMask(high_irrigation_mask)
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi,
    scale: 500, // อ้างอิงตามความละเอียดของ MODIS
    maxPixels: 1e9
  }).get('area');

// แปลงหน่วยพื้นที่
var area_sqkm = ee.Number(area_m2).divide(1e6); // ตร.ม. -> ตร.กม.
var area_rai = ee.Number(area_m2).divide(1600); // ตร.ม. -> ไร่

// แสดงผลลัพธ์ที่ Console
print('--- สรุปพื้นที่การใช้น้ำชลประทานสูง (Deficit < -50) ---');
print('พื้นที่รวม (ตารางกิโลเมตร):', area_sqkm);
print('พื้นที่รวม (ไร่):', area_rai);

// -------------------------------------------------------------------------
// 5. การวิเคราะห์รายเดือนตลอดทั้งปี (Monthly Time-Series)
// -------------------------------------------------------------------------
var months = ee.List.sequence(1, 12); // ลิสต์เดือน 1 ถึง 12

// สร้างฟังก์ชันวนลูปคำนวณ Deficit ในแต่ละเดือน
var calculateMonthlyDeficit = function(m) {
  var start = ee.Date.fromYMD(year, m, 1);
  var end = start.advance(1, 'month');
  
  var et_month = ee.ImageCollection("MODIS/006/MOD16A2")
    .filterDate(start, end)
    .filterBounds(roi)
    .select('ET')
    .sum().multiply(0.1);
    
  var pr_month = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
    .filterDate(start, end)
    .filterBounds(roi)
    .select('precipitation')
    .sum();
    
  return pr_month.subtract(et_month)
    .updateMask(final_mask)
    .set('system:time_start', start.millis())
    .set('month', m)
    .rename('deficit');
};

var monthlyDeficitCol = ee.ImageCollection.fromImages(months.map(calculateMonthlyDeficit));

// -------------------------------------------------------------------------
// 6. การแสดงผล (Visualization & Charts)
// -------------------------------------------------------------------------
// 6.1 แผนที่ Deficit รวมช่วงหน้าแล้ง
var deficitVis = {
  min: -210, 
  max: 170,
  palette: ['d73027', 'fc8d59', 'fee090', 'e0f3f8', '91bfdb', '4575b4']
};
Map.addLayer(dry_season_deficit, deficitVis, '1. Water Deficit (ม.ค.-เม.ย. 2022)');

// 6.2 แผนที่พื้นที่ใช้น้ำชลประทานสูง (ซ่อนไว้เป็นค่าเริ่มต้น เปิดดูได้ที่ Layer)
Map.addLayer(high_irrigation_mask.updateMask(high_irrigation_mask), 
  {palette: ['black']}, '2. พื้นที่ใช้น้ำชลประทานสูง (Mask)', false);

// 6.3 ดึงข้อมูลเฉพาะเดือนมีนาคมมาแสดง (ซ่อนไว้เป็นค่าเริ่มต้น)
var march_deficit = ee.Image(monthlyDeficitCol.filter(ee.Filter.eq('month', 3)).first());
Map.addLayer(march_deficit.clip(roi), deficitVis, '3. Deficit เฉพาะเดือนมีนาคม 2022', false);

// 6.4 พล็อตกราฟรายเดือนลง Console
var chart = ui.Chart.image.series({
  imageCollection: monthlyDeficitCol,
  region: roi,
  reducer: ee.Reducer.mean(),
  scale: 500,
  xProperty: 'system:time_start'
}).setOptions({
  title: 'ค่าเฉลี่ย Water Deficit รายเดือน ปี 2022 (เฉพาะพื้นที่เกษตร)',
  vAxis: {title: 'Deficit (มิลลิเมตร)'},
  hAxis: {title: 'เวลา (เดือน)'},
  lineWidth: 3,
  pointSize: 5,
  colors: ['#d73027']
});

print('กราฟวิเคราะห์แนวโน้มรายเดือน:', chart);

