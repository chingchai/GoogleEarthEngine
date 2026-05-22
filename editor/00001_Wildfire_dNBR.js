// ========================================================
// 🌲 Wildfire Burn Severity (dNBR) Interactive App
// ========================================================

// 1. ล้างหน้าจอเดิมและสร้างโครงสร้าง UI (Panel ซ้าย, Map ขวา)
ui.root.clear();
var panel = ui.Panel({style: {width: '350px', padding: '15px'}});
var map = ui.Map();
ui.root.add(panel);
ui.root.add(map);

// ตั้งค่าเริ่มต้นของแผนที่ (ซูมไปที่ประเทศไทย)
map.setCenter(100.5, 13.7, 6);

// ========================================================
// 2. สร้างส่วนประกอบในแผงควบคุม (Widgets)
// ========================================================

// หัวข้อ App
panel.add(ui.Label({
  value: '🔥 Wildfire dNBR Analysis App',
  style: {fontWeight: 'bold', fontSize: '20px', margin: '10px 0 20px 0', color: '#cc0000'}
}));
panel.add(ui.Label('แอปพลิเคชันประเมินพื้นที่ถูกไฟไหม้จากดาวเทียม Sentinel-2'));

// --- ส่วนกำหนดวันที่ ---
panel.add(ui.Label('📅 1. กำหนดช่วงเวลา (YYYY-MM-DD)', {fontWeight: 'bold', margin: '20px 0 4px 0'}));

panel.add(ui.Label('ช่วงเวลาก่อนเกิดไฟป่า (Pre-fire):', {fontSize: '12px', color: 'gray'}));
var preStartBox = ui.Textbox({placeholder: 'Start Date', value: '2023-01-01', style: {width: '150px'}});
var preEndBox = ui.Textbox({placeholder: 'End Date', value: '2023-01-31', style: {width: '150px'}});
panel.add(ui.Panel([preStartBox, preEndBox], ui.Panel.Layout.flow('horizontal')));

panel.add(ui.Label('ช่วงเวลาหลังเกิดไฟป่า (Post-fire):', {fontSize: '12px', color: 'gray'}));
var postStartBox = ui.Textbox({placeholder: 'Start Date', value: '2023-04-20', style: {width: '150px'}});
var postEndBox = ui.Textbox({placeholder: 'End Date', value: '2023-05-15', style: {width: '150px'}});
panel.add(ui.Panel([postStartBox, postEndBox], ui.Panel.Layout.flow('horizontal')));

// --- ส่วนวาดพื้นที่ ---
panel.add(ui.Label('📍 2. เลือกพื้นที่ศึกษา', {fontWeight: 'bold', margin: '20px 0 4px 0'}));
panel.add(ui.Label('คลิกปุ่มด้านล่าง แล้วลากกรอบสี่เหลี่ยมบนแผนที่', {fontSize: '12px'}));

var drawingTools = map.drawingTools();
drawingTools.setShown(false); // ซ่อนแถบเครื่องมือวาดรูปปกติ
while (drawingTools.layers().length() > 0) {
  drawingTools.layers().remove(drawingTools.layers().get(0)); // ล้างรูปที่เคยวาด
}
var dummyGeometry = ui.Map.GeometryLayer({geometries: null, name: 'geometry', color: 'red'});
drawingTools.layers().add(dummyGeometry);

var drawButton = ui.Button({
  label: '✏️ วาดพื้นที่ (Draw Rectangle)',
  onClick: function() {
    // [แก้ไขใหม่] เปิดเลเยอร์วาดพื้นที่ให้กลับมาแสดงผลก่อนจะเริ่มวาดเพื่อให้เห็นขอบเขตที่เลือก
    drawingTools.layers().get(0).setShown(true);
    drawingTools.setShape('rectangle');
    drawingTools.draw();
  },
  style: {stretch: 'horizontal'}
});
panel.add(drawButton);

// --- ปุ่มประมวลผล ---
panel.add(ui.Label('🚀 3. ประมวลผล', {fontWeight: 'bold', margin: '20px 0 4px 0'}));
var runButton = ui.Button({
  label: 'วิเคราะห์ข้อมูล (Run Analysis)',
  style: {stretch: 'horizontal', color: 'darkgreen'},
  onClick: runAnalysis
});
panel.add(runButton);

// ========================================================
// 3. ฟังก์ชันหลักสำหรับประมวลผลเมื่อกดปุ่ม Run
// ========================================================
function runAnalysis() {
  // ดึงพื้นที่ที่ผู้ใช้วาด
  var roi = drawingTools.layers().get(0).getEeObject();
  if (!roi) {
    alert('กรุณาวาดพื้นที่บนแผนที่ก่อนกดวิเคราะห์ครับ!');
    return;
  }
  
  // [แก้ไขใหม่] ปิดการแสดงผลเลเยอร์เรขาคณิตสีแดงทึบไม่ให้บังข้อมูลแผนที่ผลลัพธ์
  drawingTools.layers().get(0).setShown(false);
  
  // ล้างเลเยอร์ผลลัพธ์เก่าบนแผนที่
  map.layers().reset();
  
  // ดึงค่าวันที่จาก Textbox
  var preStart = preStartBox.getValue();
  var preEnd = preEndBox.getValue();
  var postStart = postStartBox.getValue();
  var postEnd = postEndBox.getValue();
  
  // ฟังก์ชันกำจัดเมฆ
  function maskS2clouds(image) {
    var qa = image.select('QA60');
    var cloudBitMask = 1 << 10;
    var cirrusBitMask = 1 << 11;
    var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
    return image.updateMask(mask).divide(10000).copyProperties(image, ["system:time_start"]);
  }

  // ดึงข้อมูล Sentinel-2
  var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(roi).map(maskS2clouds);
  var preImg = s2.filterDate(preStart, preEnd).median().clip(roi);
  var postImg = s2.filterDate(postStart, postEnd).median().clip(roi);

  // คำนวณ NBR และ dNBR
  var nbrPre = preImg.normalizedDifference(['B8', 'B12']).rename('NBR_PRE');
  var nbrPost = postImg.normalizedDifference(['B8', 'B12']).rename('NBR_POST');
  var dnbr = nbrPre.subtract(nbrPost).rename('dNBR');

  // จำแนกระดับความรุนแรง
  var dnbrClassified = ee.Image(0)
    .where(dnbr.lte(-0.1), 1)                               
    .where(dnbr.gt(-0.1).and(dnbr.lte(0.1)), 2)             
    .where(dnbr.gt(0.1).and(dnbr.lte(0.27)), 3)             
    .where(dnbr.gt(0.27).and(dnbr.lte(0.66)), 4)            
    .where(dnbr.gt(0.66), 5)                                
    .updateMask(dnbr.mask());                               

  // ========================================================
  // 🌟 [เพิ่มใหม่] กรองพื้นที่เมือง (Built-up) และ แหล่งน้ำ (Water) 🌟
  // ========================================================
  // ดึงข้อมูล ESA WorldCover v200 (ปี 2021) ขอบเขตตามพื้นที่ศึกษา
  var landcover = ee.ImageCollection("ESA/WorldCover/v200").first().clip(roi);
  
  // ระบุ Class ที่ไม่ต้องการ: 50 = พื้นที่เมือง/สิ่งปลูกสร้าง, 80 = แหล่งน้ำ
  var nonUrban = landcover.neq(50);
  var nonWater = landcover.neq(80);
  
  // รวมเงื่อนไข (ต้องไม่ใช่เมือง และ ต้องไม่ใช่น้ำ)
  var validAreaMask = nonUrban.and(nonWater);
  
  // อัปเดต Mask ตัดพื้นที่ดังกล่าวออกจากผลลัพธ์ dNBR
  dnbrClassified = dnbrClassified.updateMask(validAreaMask);
  // ========================================================
  
  // แสดงผลลงบนแผนที่
  var severityPalette = ['008000', '00fc00', 'ffff00', 'ffaa00', 'ff0000'];
  var severityVis = {min: 1, max: 5, palette: severityPalette};
  
  map.addLayer(preImg, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3}, 'Pre-fire True Color', false);
  map.addLayer(postImg, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3}, 'Post-fire True Color', false);
  map.addLayer(dnbrClassified, severityVis, 'Burn Severity (dNBR)', true);
  
  // ซูมไปยังพื้นที่ที่วิเคราะห์
  map.centerObject(roi);
}

// ========================================================
// 4. สร้างกล่องอธิบายสัญลักษณ์ (Legend) ใส่ไว้ใน Panel
// ========================================================
panel.add(ui.Label('📌 คำอธิบายสัญลักษณ์ (Legend)', {fontWeight: 'bold', margin: '30px 0 10px 0'}));

var severityPalette = ['008000', '00fc00', 'ffff00', 'ffaa00', 'ff0000'];
var classNames = [
  'Enhanced Regrowth (พืชฟื้นตัว)', 
  'Unburned (ไม่ถูกไฟไหม้)', 
  'Low Severity (ไหม้ระดับต่ำ)', 
  'Moderate Severity (ไหม้ระดับกลาง)', 
  'High Severity (ไหม้รุนแรงมาก)'
];

for (var i = 0; i < 5; i++) {
  var colorBox = ui.Label({style: {backgroundColor: '#' + severityPalette[i], padding: '8px', margin: '0 0 4px 0'}});
  var description = ui.Label({value: classNames[i], style: {margin: '0 0 4px 6px', fontSize: '13px'}});
  panel.add(ui.Panel({widgets: [colorBox, description], layout: ui.Panel.Layout.Flow('horizontal')}));
}