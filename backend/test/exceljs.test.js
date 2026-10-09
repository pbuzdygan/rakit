import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

test('ExcelJS writes and reads XLSX with its patched UUID dependency', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Servers');
  sheet.addRow(['Server', 'Updates']);
  sheet.addRow(['buzpc00-dev', 5]);
  sheet.addRow(['buzhulk', 22]);
  // Extended conditional formatting exercises ExcelJS's CommonJS UUID v4 call.
  sheet.addConditionalFormatting({
    ref: 'B2:B3',
    rules: [{
      type: 'iconSet', iconSet: '3Stars',
      cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }],
    }],
  });

  const buffer = await workbook.xlsx.writeBuffer();
  assert.match(sheet.conditionalFormattings[0].rules[0].x14Id, /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const restoredSheet = restored.getWorksheet('Servers');
  assert.equal(restoredSheet.getCell('A2').value, 'buzpc00-dev');
  assert.equal(restoredSheet.getCell('B2').value, 5);
  assert.equal(restoredSheet.getCell('B3').value, 22);
  assert.equal(restoredSheet.conditionalFormattings[0].rules[0].iconSet, '3Stars');
});
