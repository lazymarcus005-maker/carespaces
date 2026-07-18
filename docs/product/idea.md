ไอเดียตอนนี้ solid ระดับหนึ่งแล้ว และมีจุดต่างจาก marketplace ทั่วไปชัดเจน

## Product Concept

แพลตฟอร์มสำหรับค้นหา จ้างงาน และติดตามการดูแลผู้สูงอายุ ผู้ป่วยติดเตียง และผู้ป่วยพักฟื้น โดยเชื่อมผู้ว่าจ้างกับ Caregiver ผู้ช่วยพยาบาล และพยาบาลวิชาชีพที่ผ่านการตรวจสอบ

ระบบครอบคลุมตั้งแต่:

* ประกาศงาน
* คัดกรองบุคลากร
* จับคู่ตามทักษะและข้อจำกัดของงาน
* ชำระเงินผ่านแพลตฟอร์ม
* ติดตามงานแบบ real-time
* ส่งมอบงาน
* จัดการข้อพิพาท
* หาคนทดแทน
* เก็บ Care Record ต่อเนื่อง

แก่นของผลิตภัณฑ์คือ:

> **แพลตฟอร์มหาผู้ดูแลและพยาบาลที่ผ่านการตรวจสอบ พร้อมระบบติดตามการดูแลอย่างต่อเนื่อง**

---

# 1. กลุ่มลูกค้า

## Phase 1: B2C

กลุ่มหลัก:

* ครอบครัวที่หาผู้ดูแลผู้สูงอายุ
* ครอบครัวผู้ป่วยติดเตียง
* ผู้ป่วยพักฟื้นหลังออกจากโรงพยาบาล

## Phase 2: B2B

ขยายไปยัง:

* โรงพยาบาล
* คลินิก
* ศูนย์ดูแลผู้สูงอายุ
* Nursing home
* Home care agency

ผมเห็นด้วยกับการเริ่ม B2C ก่อน เพราะตัดสินใจเร็วกว่าและทดสอบ product-market fit ได้ง่ายกว่า แต่ระบบข้อมูลและสิทธิ์ควรออกแบบให้รองรับ B2B ตั้งแต่ต้น

---

# 2. User Roles

ระบบควรมี role หลักดังนี้

## ผู้ว่าจ้าง

* สมาชิกครอบครัว
* ผู้ประสานงานผู้ป่วย
* โรงพยาบาล
* คลินิก
* ศูนย์ดูแลผู้สูงอายุ

## ผู้ให้บริการ

* Caregiver
* ผู้ช่วยพยาบาล
* พยาบาลวิชาชีพ

## เจ้าหน้าที่แพลตฟอร์ม

* Verification officer
* Care coordinator
* Customer support
* Dispute officer
* Clinical reviewer
* Finance administrator

---

# 3. รูปแบบงาน

ระบบรองรับ:

* รายชั่วโมง
* รายวัน
* กะกลางวัน
* กะกลางคืน
* อยู่ประจำบ้าน
* ระยะสั้น
* ระยะยาว
* งานเร่งด่วน
* งานทดแทน
* พาไปโรงพยาบาล
* งานดูแลทั่วไป
* งานที่มีหัตถการ
* งานตาม Care Plan

ทุกงานต้องระบุอย่างน้อย:

* ประเภทผู้ป่วย
* ระดับการช่วยเหลือตัวเอง
* โรคหรือเงื่อนไขสำคัญ
* งานที่ต้องทำ
* ทักษะที่ต้องการ
* ระดับบุคลากรขั้นต่ำ
* สถานที่
* วันและเวลา
* ระยะเวลา
* งบประมาณ
* ความเร่งด่วน
* อุปกรณ์ที่มี
* ความเสี่ยงของเคส

---

# 4. Matching Model

ระบบใช้หลายรูปแบบตามลักษณะงาน

## งานปกติ

1. ผู้ว่าจ้างสร้างประกาศ
2. ระบบตรวจ requirement
3. ระบบแนะนำผู้ดูแลที่เหมาะสม
4. ผู้ว่าจ้างเปรียบเทียบและเลือก
5. ผู้ดูแลยืนยันงาน
6. ชำระเงินและเริ่มกระบวนการจ้าง

## งานเร่งด่วน

1. ผู้ว่าจ้างเลือก Emergency หรือ Urgent
2. ระบบหา qualified caregiver ตามพื้นที่
3. Broadcast ไปยังผู้ที่พร้อมรับงาน
4. คนแรกที่ผ่านเกณฑ์และยืนยันได้ จะได้รับสิทธิ์เบื้องต้น
5. ระบบตรวจ credential ซ้ำก่อนยืนยัน
6. หากไม่มีผู้รับ เจ้าหน้าที่เข้าช่วยทันที

ไม่ควรใช้ pure first-come-first-served โดยไม่ตรวจ qualification เพราะอาจได้คนที่ตอบเร็วแต่ไม่เหมาะกับเคส

## เคสซับซ้อน

* มีการประเมินโดย Care Coordinator หรือพยาบาล
* ตรวจ Care Plan
* กำหนดระดับบุคลากร
* คัด shortlist
* ผู้ว่าจ้างเลือกจากรายชื่อที่ผ่านการคัดกรอง

---

# 5. Provider Verification

## พยาบาลวิชาชีพ

ต้องมี:

* ยืนยันตัวตน
* ใบประกอบวิชาชีพ
* ประวัติการทำงาน
* ใบอบรมเฉพาะทาง
* ตรวจประวัติ
* สัมภาษณ์
* ตรวจวันหมดอายุเอกสาร

## ผู้ช่วยพยาบาล

ต้องมี:

* ยืนยันตัวตน
* ใบรับรองหลักสูตร
* ประวัติการทำงาน
* ตรวจประวัติ
* ตรวจประสบการณ์

## Caregiver

ต้องมีอย่างใดอย่างหนึ่ง:

* ใบอบรม Caregiver
* หลักฐานประสบการณ์ที่ตรวจสอบได้
* เอกสารอ้างอิง
* การอนุมัติจากแพลตฟอร์ม

ผู้สมัครที่ยังไม่ผ่านการตรวจสอบสามารถสร้างบัญชีและส่งเอกสารได้ แต่ยัง:

* สมัครงานไม่ได้
* รับ broadcast ไม่ได้
* แสดงในผลการค้นหาไม่ได้
* รับชำระเงินไม่ได้

สถานะที่แนะนำ:

```text
Draft
Submitted
Under Review
Need More Information
Approved
Conditionally Approved
Suspended
Rejected
Expired
```

---

# 6. Skill and Permission Matrix

ระบบต้องใช้ rule engine บล็อกงานตาม qualification ไม่ใช่ใช้แค่ข้อความบนโปรไฟล์

| งาน                    | Caregiver      | ผู้ช่วยพยาบาล  | พยาบาล |
| ---------------------- | -------------- | -------------- | ------ |
| ดูแลทั่วไป             | ได้            | ได้            | ได้    |
| พาไปโรงพยาบาล          | ได้            | ได้            | ได้    |
| ช่วยอาบน้ำ / ป้อนอาหาร | ได้            | ได้            | ได้    |
| วัดความดัน / น้ำตาล    | ต้องมีใบอบรม   | ได้            | ได้    |
| ให้อาหารทางสาย         | ต้องมีใบรับรอง | ตามขอบเขต      | ได้    |
| ทำแผล                  | จำกัด          | จำกัด          | ได้    |
| ฉีดยา                  | ไม่ได้         | จำกัดตามสิทธิ์ | ได้    |
| ประเมินอาการ           | ไม่ได้         | บันทึกข้อมูล   | ได้    |

ทุกงานควรมี:

```text
RequiredProviderType
RequiredSkills
RequiredCertificates
AllowedActivities
RestrictedActivities
ClinicalRiskLevel
```

ตัวอย่าง:

```text
Job: ดูแลผู้ป่วยติดเตียงที่มีแผลกดทับ
Minimum role: Nurse Assistant
Required skills:
- Bedridden patient care
- Pressure sore prevention
- Vital signs
Restricted:
- Advanced wound dressing
Clinical review required: Yes
```

---

# 7. Care Management Flow

## ก่อนเริ่มงาน

* ผู้ว่าจ้างสร้างข้อมูลผู้ป่วย
* เลือก Care Plan template
* เพิ่มกิจกรรม
* ระบุยา
* ระบุข้อควรระวัง
* ระบุผู้ติดต่อฉุกเฉิน
* พยาบาลตรวจสอบเคสซับซ้อน

## ระหว่างงาน

ผู้ดูแลดำเนินการตาม checkpoint

ตัวอย่าง:

```text
Check-in
ตรวจสภาพผู้ป่วยเบื้องต้น
วัด vital signs
มื้ออาหาร
การให้ยา
กิจกรรมดูแล
การขับถ่าย
เหตุการณ์ผิดปกติ
สรุปก่อนออกกะ
Check-out
```

## หลังจบงาน

* ผู้ดูแลส่ง care report
* ผู้ว่าจ้างตรวจสอบ
* ผู้ว่าจ้างรับรองงาน
* ระบบปล่อยเงิน
* อัปเดต performance score
* บันทึกข้อมูลเข้าประวัติการดูแล

---

# 8. Reporting Model

ช่วงแรกไม่ควรบังคับกรอกทุกอย่าง เพราะจะทำให้ผู้ดูแลใช้ระบบยากและเลิกใช้งาน

แนะนำแบ่งเป็น 3 ระดับ

## Mandatory Checkpoint

ต้องทำทุกงาน:

* Check-in
* Check-out
* กิจกรรมสำคัญที่ได้รับมอบหมาย
* Incident
* Medication confirmation ถ้ามี
* สรุปส่งมอบงาน

## Conditional Checkpoint

บังคับตาม Care Plan:

* ความดัน
* น้ำตาล
* อุณหภูมิ
* มื้ออาหาร
* ปริมาณน้ำ
* การขับถ่าย
* รูปแผล
* การเปลี่ยนท่า

## Optional Quality Reporting

ไม่บังคับ แต่ให้คะแนนเพิ่ม:

* รายงานละเอียด
* แนบรูปตามความเหมาะสม
* บันทึกความเปลี่ยนแปลง
* เขียน note เพิ่ม
* ส่งมอบข้อมูลครบ
* แจ้งเตือนก่อนเกิดปัญหา

แนวคิดนี้ดี เพราะสร้างแรงจูงใจโดยไม่เพิ่ม friction มากเกินไป

---

# 9. Real-time Tracking

ผู้ว่าจ้างเห็นสถานะ:

```text
Confirmed
Preparing
On the way
Arrived
Checked in
Care in progress
Checkpoint completed
Incident reported
Preparing handoff
Checked out
Awaiting approval
Completed
```

GPS ควรเก็บเฉพาะช่วงที่จำเป็น เช่น:

* ตอนกดเดินทาง
* ตอน check-in
* ตอน check-out
* ตอนส่ง SOS

ไม่ควรติดตามตำแหน่งตลอดกะโดยไม่มีเหตุผล เพราะมีทั้งประเด็น privacy และแบตเตอรี่

---

# 10. Payment Flow

รูปแบบที่เลือกเหมาะกับ marketplace ที่ต้องควบคุมคุณภาพ

```text
ลูกค้าสร้างงาน
→ ระบบคำนวณราคา
→ ลูกค้าชำระเงิน
→ ระบบพักเงิน
→ ผู้ดูแลทำงาน
→ ผู้ดูแลส่งงาน
→ ลูกค้ารับรอง
→ ระบบหัก commission
→ ระบบจ่ายเงินให้ผู้ดูแล
```

กรณีลูกค้าไม่กดรับรองภายในเวลาที่กำหนด:

* ส่ง reminder
* auto-complete หลังหมด dispute window
* ปล่อยเงินอัตโนมัติหากไม่มี complaint

ควรมี:

* Cancellation policy
* Late cancellation fee
* No-show policy
* Refund policy
* Overtime calculation
* Expense reimbursement
* Dispute evidence
* Payout schedule

---

# 11. Revenue Model

รายได้หลักคือ Marketplace Commission

ตัวอย่างโมเดล:

* หัก commission จากผู้ให้บริการ
* เก็บ platform fee จากผู้ว่าจ้าง
* เพิ่ม urgent service fee
* เพิ่ม replacement guarantee fee
* คิดค่าบริการ clinical review

ตัวอย่างเชิงโครงสร้าง:

```text
Caregiver payout: 85–90%
Platform commission: 10–15%
Urgent job fee: เพิ่มตามระดับความเร่งด่วน
Clinical review fee: เฉพาะเคสซับซ้อน
```

ยังไม่ควรล็อกเปอร์เซ็นต์จนกว่าจะทดสอบต้นทุนการหาลูกค้า การ support และอัตราการยกเลิกงานจริง

---

# 12. Replacement Guarantee

นี่เป็น competitive advantage ที่แข็งแรงมาก

Flow:

```text
ผู้ดูแลยกเลิก
→ ระบบเปิด replacement request
→ ค้นหาคนที่ผ่าน qualification
→ broadcast ไปยัง standby pool
→ เสนอราคาและ incentive
→ ตรวจสอบผู้รับใหม่
→ แจ้งผู้ว่าจ้าง
→ เจ้าหน้าที่เข้าช่วยหากไม่สำเร็จ
```

SLA ที่ตั้งไว้:

> หาคนทดแทนภายใน 2 ชั่วโมง

แต่ควรเขียนเป็น:

> “แพลตฟอร์มจะเริ่มกระบวนการหาคนทดแทนทันที และพยายามจัดหาภายใน SLA ตามพื้นที่และระดับความซับซ้อนของงาน”

เพราะการรับประกันว่าหาได้ทุกกรณีมี operational risk สูง โดยเฉพาะงานพยาบาลเฉพาะทางหรือพื้นที่ห่างไกล

---

# 13. Emergency Flow

เมื่อกด SOS:

1. แสดงขั้นตอนประเมินเบื้องต้น
2. โทรหาญาติ
3. โทร 1669
4. ส่งพิกัด
5. แจ้งเจ้าหน้าที่แพลตฟอร์ม
6. เปิด incident record
7. บันทึกเวลาและเหตุการณ์
8. แนบรูปหรือ note
9. ติดตามสถานะจนปิด incident

สถานะ incident:

```text
Reported
Acknowledged
Emergency Contact Called
Emergency Service Contacted
Escalated
Resolved
Closed
```

แพลตฟอร์มควรระบุชัดว่าเป็นระบบสนับสนุนการสื่อสารและบันทึกเหตุการณ์ ไม่ใช่บริการแพทย์ฉุกเฉินโดยตัวมันเอง

---

# 14. Care Plan

Care Plan รองรับหลายแหล่ง:

* Template จากระบบ
* ญาติสร้างเอง
* โรงพยาบาลส่งมา
* พยาบาลสร้าง
* เจ้าหน้าที่แพลตฟอร์มช่วยจัดทำ

Care Plan ควรมี versioning เพราะข้อมูลอาจเปลี่ยนระหว่างการรักษา

```text
Care Plan v1
Care Plan v2
Effective date
Created by
Reviewed by
Change reason
```

Checklist ของผู้ดูแลต้องอ้างอิง Care Plan version ที่ใช้งานในกะนั้น เพื่อป้องกันการสับสนเมื่อมีการแก้ไข

---

# 15. Internal Scoring Model

เห็นด้วยที่ไม่ควรแสดงทุกคะแนนต่อสาธารณะ

## คะแนนที่แสดงต่อผู้ว่าจ้าง

* จำนวนงานที่สำเร็จ
* อัตราตรงต่อเวลา
* ทักษะที่ยืนยันแล้ว
* ประสบการณ์
* รีวิวโดยรวม
* Availability

## คะแนนภายใน

* Cancellation rate
* No-show rate
* Late rate
* Complaint rate
* Incident rate
* Report completeness
* Care Plan compliance
* Response speed
* Acceptance consistency
* Continuity score
* Replacement reliability

ตัวอย่างคะแนนภายใน:

```text
Provider Trust Score
Clinical Compliance Score
Reliability Score
Documentation Score
Customer Satisfaction Score
Overall Matching Score
```

คะแนนเหล่านี้ใช้เพื่อ:

* จัดอันดับผลการค้นหา
* เลือกคนรับงานเร่งด่วน
* กำหนดวงเงินงาน
* เลือกเข้า standby pool
* ตรวจจับ provider ที่มีความเสี่ยง
* ให้ badge หรือ incentive

---

# 16. MVP Scope

MVP ไม่ควรทำทุกอย่างพร้อมกัน

## MVP Phase 1

### ฝั่งผู้ว่าจ้าง

* สมัครและยืนยันตัวตน
* สร้างข้อมูลผู้ป่วย
* สร้างประกาศงาน
* เลือก Care Plan template
* ดูผู้ดูแลที่แนะนำ
* เลือกและจ้าง
* ชำระเงิน
* ดูสถานะงาน
* รับแจ้งเตือน
* ดู checkpoint
* รับรองงาน
* เปิด dispute
* รีวิว

### ฝั่งผู้ดูแล

* สมัคร
* อัปโหลดเอกสาร
* สร้างโปรไฟล์
* ระบุทักษะ
* ระบุตารางว่าง
* ดูงาน
* สมัครหรือรับงาน
* Check-in
* ทำ checklist
* รายงาน incident
* Check-out
* ส่ง handoff report
* ดูรายได้

### ฝั่ง Admin

* ตรวจเอกสาร
* อนุมัติ provider
* ตรวจประกาศงาน
* จัดการ matching
* ดู active jobs
* ช่วยหาคนทดแทน
* จัดการ dispute
* ดู payment
* ระงับบัญชี

## ยังไม่ควรทำใน MVP

* AI วินิจฉัยอาการ
* Telemedicine เต็มรูปแบบ
* เชื่อมโรงพยาบาลหลายแห่ง
* ระบบ payroll ซับซ้อน
* Insurance integration
* Wearable integration
* IoT monitoring
* Training academy เต็มรูปแบบ
* Predictive health analytics

---

# 17. High-level System Modules

```text
Identity and Access
Provider Verification
Patient Profile
Care Plan
Job Marketplace
Matching Engine
Scheduling
Real-time Care Tracking
Notification
Payment and Escrow
Payout
Incident Management
Replacement Management
Review and Internal Scoring
Admin Operations
Audit and Compliance
B2B Organization Management
```

---

# 18. Core Data Model

Entity หลัก:

```text
User
FamilyMember
Organization
Patient
PatientContact
ProviderProfile
ProviderType
Credential
Certificate
Skill
ProviderSkill
Availability
Job
JobRequirement
JobApplication
JobAssignment
Shift
CarePlan
CarePlanVersion
CareTask
CareCheckpoint
VitalRecord
MedicationRecord
CareNote
Attachment
Incident
EmergencyContact
Payment
Escrow
Payout
Refund
Dispute
Review
ProviderScore
ReplacementRequest
Notification
AuditLog
```

---

# 19. Core Value Proposition

เวอร์ชันที่ชัดและใช้สื่อสารได้:

> แพลตฟอร์มสำหรับค้นหาและจ้างผู้ดูแล ผู้ช่วยพยาบาล และพยาบาลที่ผ่านการตรวจสอบ พร้อมระบบติดตามการดูแลผู้ป่วย ส่งมอบงาน และจัดหาคนทดแทนเมื่อเกิดปัญหา

เวอร์ชันสั้น:

> **หาคนดูแลที่เหมาะสม ติดตามงานได้ และไม่ขาดช่วงเมื่อมีคนยกเลิก**

---

# 20. ประเด็นสุดท้ายที่ต้องล็อก

ตอนนี้เหลือ decision สำคัญก่อนออกแบบ Product Requirement จริง

1. แพลตฟอร์มเป็นนายหน้าจับคู่ หรือเป็นผู้รับผิดชอบจัดส่งบุคลากรเอง
2. ผู้ว่าจ้างกำหนดราคาเอง หรือระบบกำหนดช่วงราคา
3. ผู้ดูแลสมัครงานได้หลายงานพร้อมกันหรือไม่
4. ผู้ดูแลต้องรับงานขั้นต่ำต่อเดือนหรือไม่
5. งานระยะยาวจ่ายรายกะ รายสัปดาห์ หรือรายเดือน
6. รูปแบบ commission หักจากฝั่งใด
7. พื้นที่เปิดตัวแรกคือกรุงเทพฯ หรือกรุงเทพฯ และปริมณฑล
8. ช่วงแรกจะรับเฉพาะผู้ดูแลที่มีเอกสารครบ หรือเปิด conditional approval ด้วย
9. เจ้าหน้าที่แพลตฟอร์มทำงาน 24 ชั่วโมงสำหรับ SOS และ replacement หรือไม่
10. ผู้ว่าจ้างสามารถจ้างผู้ดูแลเดิมนอกระบบภายหลังได้หรือมี anti-circumvention policy

จากข้อมูลทั้งหมด ผมแนะนำ product direction นี้:

> เริ่มจาก B2C marketplace สำหรับงานดูแลรายวัน รายกะ และงานระยะสั้นในกรุงเทพฯ โดยรับเฉพาะ provider ที่ผ่าน verification ใช้ Care Plan แบบ checklist บังคับเฉพาะ checkpoint สำคัญ มี escrow payment และมีเจ้าหน้าที่ช่วย matching/replacement สำหรับเคสเร่งด่วน ก่อนขยายไปสู่งานระยะยาวและ B2B workforce management.
