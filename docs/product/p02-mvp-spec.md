# Carespaces — MVP Product & Functional Specification (P02)

> สถานะ: Draft baseline สำหรับแตก backlog และออกแบบ P03
>
> วันที่: 13 กรกฎาคม 2026
>
> อ้างอิง: `idea.md` และ `p01-design.md`
> ขอบเขต: B2C managed marketplace สำหรับงานดูแลหนึ่งกะในพื้นที่นำร่องกรุงเทพฯ

## 1. วัตถุประสงค์

เอกสารนี้แปลง product concept และ architecture decisions เป็นข้อกำหนด MVP ที่ Product, Design, Engineering, Clinical, Operations และ QA ใช้อ้างอิงร่วมกัน โดยกำหนดว่าใครทำอะไร ระบบต้องตอบสนองอย่างไร และเงื่อนไขใดถือว่างานสำเร็จ

เป้าหมายของ MVP คือพิสูจน์ว่า Carespaces สามารถทำวงจรต่อไปนี้ได้อย่างปลอดภัยและตรวจสอบย้อนหลังได้:

```text
Provider ที่ผ่านการตรวจสอบ
→ งานที่มี requirement ชัดเจน
→ qualification-based matching
→ การจองและชำระเงินผ่านระบบ
→ การทำงานตาม Care Plan
→ care report และหลักฐาน
→ การรับรองงานและ payout
→ dispute/replacement เมื่อมีปัญหา
```

## 2. Product outcome และตัวชี้วัด pilot

### 2.1 Primary outcome

ครอบครัวสามารถจองบุคลากรที่ผ่านการตรวจสอบและเหมาะกับงาน ติดตามการทำงาน และได้รับรายงานหลังจบกะ โดยมีเจ้าหน้าที่ช่วยจัดการเหตุผิดปกติภายในขอบเขตเวลาที่ประกาศ

### 2.2 Pilot metrics

| Metric | นิยามเบื้องต้น |
|---|---|
| Qualified fill rate | สัดส่วนงานที่ได้ provider ซึ่งผ่าน hard qualification gate |
| Time to confirmed assignment | เวลาจาก publish job ถึง assignment confirmed |
| Provider cancellation rate | สัดส่วน assignment ที่ provider ยกเลิกหลัง confirmed |
| On-time check-in rate | สัดส่วนกะที่ check-in ภายใน grace period ตาม policy |
| Mandatory checkpoint completion | สัดส่วน checkpoint บังคับที่บันทึกครบ |
| Report completion rate | สัดส่วนกะที่ส่ง handoff report สำเร็จ |
| Replacement success | สัดส่วนคำขอ replacement ที่ได้ผู้ทดแทนก่อนกะเริ่มหรือก่อน deadline |
| Dispute rate | สัดส่วนกะที่เปิด dispute |
| Payment reconciliation exceptions | จำนวนรายการที่ ledger ไม่ตรงกับ PSP settlement |

ค่าเป้าหมายเชิงตัวเลขให้กำหนดใน pilot plan หลังมี provider density, staffing capacity และ PSP flow ที่ยืนยันแล้ว เพื่อไม่สร้าง SLA ที่ operation รองรับไม่ได้

## 3. MVP boundary

### 3.1 In scope

- B2C สำหรับผู้ว่าจ้างบุคคลหรือครอบครัว
- ผู้รับการดูแล: ผู้สูงอายุ ผู้ป่วยติดเตียง และผู้ป่วยพักฟื้นที่ไม่ใช่เหตุฉุกเฉิน ณ เวลาจอง
- Provider 3 ประเภท: Caregiver, ผู้ช่วยพยาบาล และพยาบาลวิชาชีพ
- งานรายครั้งแบบหนึ่ง booking ต่อหนึ่งกะ ภายในพื้นที่ pilot กรุงเทพฯ
- กะที่เริ่มและจบภายในเวลา care ops `08:00–20:00 น.` เขตเวลา `Asia/Bangkok`
- งานปกติ งานเร่งด่วนที่ operation เปิดรับ และงานทดแทน
- Provider onboarding, verification, credential expiry และ suspension
- Patient profile, consent/authority, Care Plan แบบ versioned checklist
- Qualification gate, explainable ranking, customer selection และ provider confirmation
- Quote ที่ระบบคำนวณ, payment ผ่าน PSP, internal ledger, refund และ payout
- Check-in/out, checkpoint, care note, handoff report และ location snapshot ตาม event
- Incident/SOS communication support, dispute, review และ replacement workflow
- Customer web/PWA, Provider mobile app และ Admin/Care Ops web
- Notification, acknowledgement, escalation, audit และ operational reporting ที่จำเป็น

### 3.2 Out of scope

- B2B organization workflow และ enterprise billing
- กะกลางคืน กะค้างคืน อยู่ประจำบ้าน recurring schedule และสัญญาระยะยาว
- Payroll, benefits, attendance สำหรับลูกจ้างประจำ หรือ workforce management เต็มรูปแบบ
- Telemedicine, diagnosis, treatment recommendation และ emergency medical service
- Custom escrow หรือการถือเงินโดย Carespaces นอก capability ที่ PSP/กฎหมายอนุมัติ
- AI matching/diagnosis, wearable, IoT, insurance และ hospital integration
- Continuous GPS tracking หรือ background location ตลอดกะ
- Multi-region production, microservices, data warehouse และ advanced fraud scoring
- Conditional provider assignment; ผู้ที่ยังไม่ `APPROVED` รับงานไม่ได้

### 3.3 Operating boundary

- ระบบต้องแสดงพื้นที่ เวลาให้บริการ และ SLA ที่ใช้กับ booking ก่อนผู้ว่าจ้างชำระเงิน
- กะ MVP ต้องอยู่ภายใน 08:00–20:00 น. ทั้งเวลาเริ่มและเวลาจบ
- นอกเวลาทำการ ผู้ใช้ยังเปิด incident และใช้ direct-call ไปยัง `1669`/ผู้ติดต่อฉุกเฉินได้ แต่ระบบต้องไม่สัญญา acknowledgement หรือ replacement SLA
- Carespaces เป็นระบบประสานงาน บันทึก และแจ้งเหตุ ไม่ใช่บริการแพทย์ฉุกเฉิน
- เคสที่มีอาการฉุกเฉิน ณ เวลาจองต้องถูกชี้นำให้ติดต่อบริการฉุกเฉิน ไม่เข้าสู่ matching ปกติ

## 4. Actors และสิทธิ์ระดับผลิตภัณฑ์

| Actor | หน้าที่ใน MVP | ข้อจำกัดสำคัญ |
|---|---|---|
| Customer | จัดการบัญชี ผู้ป่วย งาน การเลือก provider การชำระเงิน การติดตาม รับรองงาน dispute และ review | เห็นเฉพาะผู้ป่วย/booking ที่ได้รับสิทธิ์; แก้ Care Plan ที่ publish แล้วไม่ได้ |
| Patient | เจ้าของข้อมูลและผู้รับการดูแล อาจเป็นคนเดียวกับ Customer หรือคนละคน | ต้องมี consent/authority และช่องทางจัดการสิทธิ์ตาม policy |
| Provider applicant | สร้างโปรไฟล์และส่งเอกสาร verification | ค้นหา/สมัคร/รับงานและรับ payout ไม่ได้ |
| Approved provider | จัดการ availability รับหรือปฏิเสธงาน ทำ checklist รายงาน และดูรายได้ | ทำได้เฉพาะ activity ที่ qualification/policy อนุญาตและเฉพาะ assignment ของตน |
| Verification officer | ตรวจ identity, credential และหลักฐานประสบการณ์ | อนุมัติตาม checklist/policy; การ override ต้องมีเหตุผลและ audit |
| Care coordinator | ตรวจงาน ช่วย matching ดู active shift จัดการ escalation และ replacement | เห็น clinical data เท่าที่จำเป็นต่อเคสที่รับผิดชอบ |
| Clinical reviewer | ตรวจเคสเสี่ยง Care Plan และ restricted activity | ไม่แก้ ledger หรืออนุมัติ payout |
| Support/dispute officer | ช่วยผู้ใช้ เปิด/จัดการ dispute และรวบรวมหลักฐาน | ตัดสิน finance ตาม threshold/approval policy เท่านั้น |
| Finance administrator | ดู payment, refund, payout และ reconciliation | ไม่เห็น clinical note เกินข้อมูลขั้นต่ำที่ต้องใช้พิจารณารายการเงิน |
| Platform administrator | จัดการ policy/configuration และระงับบัญชี | ต้อง MFA; privileged action และ break-glass ถูก audit |

รายละเอียด capability และ ABAC condition จะกำหนดใน P03 permission matrix

## 5. Core journeys

### 5.1 Customer happy path

1. Customer สมัครและยืนยันช่องทางติดต่อ
2. สร้าง Patient profile พร้อม relationship, authority/consent และ emergency contact
3. สร้าง Job ระบุสถานที่ เวลา ความต้องการ ความเสี่ยง และ Care Plan
4. ระบบ validate service boundary และประเมินว่าต้อง clinical review หรือไม่
5. ระบบกรอง provider ด้วย qualification gate และแสดงรายชื่อที่เหมาะสมพร้อมเหตุผลที่อธิบายได้
6. Customer เลือก provider; provider ยืนยันภายในเวลาที่กำหนด
7. ระบบออก versioned quote และ Customer ยอมรับ/ชำระผ่าน PSP
8. เมื่อ payment condition ผ่าน ระบบยืนยัน Assignment และเปิดเผย shift packet ตาม need-to-know
9. Customer ติดตามสถานะและ checkpoint ระหว่างกะ
10. Provider check-out และส่ง handoff report
11. Customer รับรองงานหรือเปิด dispute ภายใน dispute window
12. ระบบ complete งาน อัปเดต ledger/payout eligibility และเปิดให้ review

### 5.2 Provider happy path

1. Applicant สมัคร สร้างโปรไฟล์ ระบุประเภท ทักษะ ประสบการณ์ และส่งเอกสาร
2. Verification officer ตรวจและอนุมัติ; ระบบตรวจ expiry ต่อเนื่อง
3. Provider ตั้ง availability และพื้นที่บริการ
4. Provider เห็นเฉพาะงานที่ผ่าน qualification gate หรือได้รับ invitation/broadcast
5. Provider ยืนยันงานและได้รับ Assignment เมื่อ payment condition ผ่าน
6. ก่อนกะ Provider ดาวน์โหลด shift packet ที่จำเป็นสำหรับ offline read
7. Provider เปลี่ยนสถานะเดินทางและ check-in พร้อม location snapshot
8. ทำ mandatory/conditional checkpoint และรายงาน incident เมื่อจำเป็น
9. Check-out ส่ง handoff report และติดตามสถานะรายได้/payout

### 5.3 Care Ops happy path

1. ดู queue ของ verification, job review, complex case, urgent job, active shift, incident, replacement และ dispute
2. รับ ownership ของ Ops Task และเห็น SLA clock
3. ดำเนินการตาม runbook หรือประสาน Clinical/Finance
4. ใช้ manual override เฉพาะ capability ที่อนุญาต พร้อม reason
5. ปิด task เมื่อ outcome ถูกบันทึกและผู้เกี่ยวข้องได้รับแจ้ง

## 6. Functional requirements

คำว่า **ต้อง** หมายถึง MVP release requirement ส่วนคำว่า **ควร** หมายถึง requirement ที่ทำได้หลัง core flow แต่ก่อนเปิด pilot หากไม่กระทบ safety/compliance

### 6.1 Identity, access และ consent

- **IAM-01** ระบบต้องให้ Customer และ Provider สมัคร/เข้าสู่ระบบด้วยช่องทาง identity ที่อนุมัติ และยืนยันช่องทางติดต่อก่อนทำธุรกรรมสำคัญ
- **IAM-02** Provider applicant ต้องทำ verification แยกจาก authentication; มีบัญชีไม่ได้แปลว่ารับงานได้
- **IAM-03** Admin/Care Ops ทุก role ต้องใช้ MFA และ session policy ที่เข้มกว่าผู้ใช้ทั่วไป
- **IAM-04** ระบบต้องตรวจทั้ง role และ relationship/assignment/patient access ก่อนคืนข้อมูลอ่อนไหว
- **IAM-05** Customer ต้องระบุความสัมพันธ์กับ Patient และ authority/legal basis ก่อน publish งาน
- **IAM-06** Consent/authorization ต้องมีผู้ให้ ขอบเขต เวลา version ของ notice และสถานะเพิกถอน/หมดอายุ
- **IAM-07** Privileged read, export, manual override และ break-glass ต้องบันทึก actor, reason, timestamp และ correlation ID

### 6.2 Patient profile และ Care Plan

- **PAT-01** Customer ต้องสร้าง Patient profile ขั้นต่ำ ได้แก่ ชื่อที่ใช้ดูแล ข้อมูลติดต่อ/ที่อยู่ ระดับการช่วยเหลือตนเอง เงื่อนไขสำคัญ ข้อควรระวัง และ emergency contact
- **PAT-02** ระบบต้องแยกข้อมูล Patient ออกจากบัญชี Customer เพื่อรองรับผู้ว่าจ้างที่ไม่ใช่ผู้ป่วย
- **CARE-01** Customer ต้องเลือก template หรือสร้าง Care Plan ก่อน publish งาน
- **CARE-02** Care Plan ต้องมี activity, instruction, mandatory/conditional flag, schedule/trigger, restriction และ evidence requirement เท่าที่จำเป็น
- **CARE-03** Care Plan ที่ publish แล้วแก้ทับไม่ได้ การเปลี่ยนต้องสร้าง version ใหม่พร้อมผู้แก้ เวลา effective date และเหตุผล
- **CARE-04** Shift ต้อง pin `care_plan_version_id`; version ใหม่ไม่เปลี่ยน checklist ของกะที่เริ่มแล้วโดยอัตโนมัติ
- **CARE-05** Medication-related task ต้องแยก “เตือน/ยืนยันตามแผน” ออกจากการสั่งยา และต้องผ่าน activity policy ตาม provider type
- **CARE-06** Clinical-risk case หรือ restricted activity ต้องหยุดที่ review queue จน Clinical reviewer อนุมัติ requirement และ Care Plan

### 6.3 Provider onboarding และ verification

- **VER-01** Applicant ต้องบันทึก profile, provider type, skills, experience, service area, payout onboarding status และเอกสารตามประเภท provider
- **VER-02** Verification workflow ขั้นต่ำคือ `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/NEED_MORE_INFO/REJECTED`; `SUSPENDED` และ `EXPIRED` ใช้กับบัญชีที่เคยอนุมัติ
- **VER-03** MVP ต้องไม่มี `CONDITIONALLY_APPROVED` สำหรับการรับงาน
- **VER-04** การตัดสิน verification ต้องบันทึก reviewer, policy version, checklist result, reason และ evidence reference
- **VER-05** ระบบต้องเตือน credential ใกล้หมดอายุ และบล็อกการรับงานใหม่เมื่อ credential ที่จำเป็นหมดอายุ
- **VER-06** ก่อน Assignment confirmed และก่อนเริ่ม Shift ระบบต้องตรวจ provider status/credential ซ้ำ
- **VER-07** การ suspend ต้องหยุดงานใหม่ทันที และสร้าง Ops Task เพื่อตรวจ assignment ในอนาคตที่ได้รับผลกระทบ

### 6.4 Job creation และ serviceability

- **JOB-01** Job ต้องอ้างอิง Customer, Patient, location, วันที่/เวลา, duration, urgency, care-plan version และ contact ที่จำเป็น
- **JOB-02** Job requirement ต้องระบุ minimum provider type, required skills/certificates, allowed/restricted activities และ clinical risk level
- **JOB-03** ระบบต้อง reject เวลาที่อยู่นอก 08:00–20:00 น. หรือ location ที่อยู่นอกพื้นที่ pilot พร้อมข้อความอธิบาย
- **JOB-04** MVP หนึ่ง Job มีหนึ่ง Shift; การทำหลายวันต้องสร้าง Job แยกและไม่ถือเป็น recurring contract
- **JOB-05** ระบบต้องทำ clinical/serviceability validation ก่อน publish และส่งเคสที่ไม่แน่ชัดเข้า manual review
- **JOB-06** Exact address และข้อมูลสุขภาพเต็มชุดต้องไม่ปรากฏใน public/search result และเปิดให้ provider หลัง Assignment confirmed เท่านั้น
- **JOB-07** Customer แก้ requirement สำคัญหลังมี candidate/reservation ไม่ได้โดยไร้ผลกระทบ ระบบต้อง invalidate quote/match ที่เกี่ยวข้องและให้ยืนยันใหม่

### 6.5 Matching และ assignment

- **MAT-01** ระบบต้องใช้ hard qualification gate ก่อน ranking ทุกครั้ง
- **MAT-02** Gate ต้องตรวจ provider status, credential, provider type, skill/certificate, activity policy, availability conflict, service area, block/suspension และ clinical approval
- **MAT-03** Ranking ต้อง deterministic/explainable ใน policy version เดียวกัน และเก็บ feature snapshot/reason codes เพื่อ audit
- **MAT-04** Customer ต้องเห็นข้อมูลเปรียบเทียบที่จำเป็น เช่น verified skill, experience, completed jobs, punctuality band, review summary, availability และราคา โดยไม่เปิด internal risk score
- **MAT-05** Provider สมัคร/แสดงความสนใจได้หลายงาน แต่ระบบห้ามมี `RESERVED` หรือ `CONFIRMED` assignment ที่เวลาชนกัน
- **MAT-06** การเลือก provider สร้าง reservation ที่มี expiry; assignment ยังไม่ confirmed จน provider และ payment condition สำเร็จ
- **MAT-07** ระบบต้องจัดการ concurrent accept แบบ atomic ให้มีผู้ชนะเพียงหนึ่งราย และแจ้งผลที่ชัดเจนแก่รายอื่น
- **MAT-08** งาน urgent ใช้ qualified broadcast เป็น wave โดยเปิดเผยข้อมูลขั้นต่ำ; หากไม่มีผู้รับตาม deadline ต้องสร้าง Ops Task

### 6.6 Quote, payment และ payout

- **PAY-01** ระบบต้องสร้าง `PriceQuote` จาก versioned rate card ไม่รับราคาที่ provider แก้เอง
- **PAY-02** Quote ต้องแสดงค่าบริการ platform/urgent/clinical review ภาษี ส่วนลด และยอดรวมตามที่ใช้จริงก่อน Customer ยอมรับ
- **PAY-03** Quote มีอายุและต้องถูกสร้างใหม่เมื่อเวลา ขอบเขตงาน provider หรือ rate-card input สำคัญเปลี่ยน
- **PAY-04** Payment flow ต้องอยู่หลัง `PaymentProvider` adapter และใช้ PSP-supported authorization/hold, capture/void, refund และ payout ตาม legal-approved flow
- **PAY-05** ห้ามใช้คำว่า escrow ใน UX/contract/marketing จนได้รับการอนุมัติอย่างชัดแจ้ง
- **PAY-06** Assignment confirmed ได้ต่อเมื่อระบบได้รับผล payment ที่ policy กำหนดจาก PSP ไม่ใช่จาก client redirect เพียงอย่างเดียว
- **PAY-07** Webhook และ payment command ต้อง idempotent; webhook ซ้ำ ผิดลำดับ หรือมาช้าต้องไม่ทำให้ ledger ซ้ำ
- **PAY-08** Ledger transaction ต้อง balance และแก้ไขด้วย reversing entry เท่านั้น
- **PAY-09** เมื่อ Provider ส่งงาน Customer มี configurable dispute window; หากไม่ตอบและไม่มี incident/dispute ระบบจึง auto-complete ตาม policy
- **PAY-10** Payout eligibility เกิดหลัง completion และ policy checks แต่ payout สำเร็จเมื่อ PSP ยืนยันเท่านั้น
- **PAY-11** Cancellation, no-show, overtime, expense, refund และ fee ต้องคำนวณจาก versioned policy; MVP ไม่ hard-code เปอร์เซ็นต์ใน client
- **PAY-12** Finance ต้อง reconcile ledger กับ PSP settlement และสร้าง Ops Task เมื่อยอดหรือสถานะไม่ตรง

### 6.7 Shift execution และ offline behavior

- **SHIFT-01** Provider ต้องเห็น shift packet ที่มีเวลา สถานที่ contact, care-plan version, checklist, restriction และ emergency actions เฉพาะ assignment ของตน
- **SHIFT-02** Provider ต้องส่งสถานะ `PREPARING/ON_THE_WAY/ARRIVED` ตาม flow ที่กำหนด โดย location snapshot เก็บเฉพาะ event ที่อนุมัติ
- **SHIFT-03** Check-in/out ต้องบันทึก server time, device time, location, accuracy, permission status และ `client_event_id`
- **SHIFT-04** Geofence/accuracy เป็น signal สำหรับ review ไม่ใช่เหตุลงโทษอัตโนมัติ
- **SHIFT-05** Mandatory checkpoint ทุกกะคือ check-in, assigned critical activities, medication confirmation เมื่อมี, incident declaration, handoff summary และ check-out
- **SHIFT-06** Conditional checkpoint ถูกสร้างจาก Care Plan เช่น vital signs, meal, fluid, elimination, repositioning หรือ wound evidence
- **SHIFT-07** Offline queue อนุญาตเฉพาะ checkpoint/care note ที่ timestamp และ deduplicate ได้; assignment accept, payment, Care Plan edit, incident acknowledgement และ check-out finalization ต้อง online
- **SHIFT-08** Sync conflict ต้องไม่ overwrite clinical/care record เงียบ ๆ; ระบบเก็บทั้ง original/correction และแจ้งผู้ใช้เมื่อจำเป็น
- **SHIFT-09** Provider ต้องส่ง handoff report ที่สรุปงานที่ทำ checkpoint ที่ขาด observation/incident และสิ่งที่ผู้ดูแลถัดไปควรทราบ
- **SHIFT-10** Customer เห็น live status/checkpoint ตามสิทธิ์ แต่ notification/WebSocket delivery ไม่ถือเป็น acknowledgement

### 6.8 Incident และ SOS

- **INC-01** Provider และ Customer ต้องเปิด Incident ได้จาก active Shift และ Admin เปิดแทนได้พร้อม audit
- **INC-02** SOS screen ต้องแสดง direct-call สำหรับ `1669` และ emergency contact ก่อนหรือพร้อมกับการส่งข้อมูลเข้า backend
- **INC-03** การเปิด SOS ต้องพยายามสร้าง Incident พร้อม event time, reporter, shift, location snapshot, note/evidence และเริ่ม escalation workflow
- **INC-04** หาก backend ใช้งานไม่ได้ direct-call ต้องยังทำงานได้ และ mobile app ต้องเก็บ draft event เพื่อส่งภายหลังเมื่อเหมาะสม
- **INC-05** Critical alert ต้องมี acknowledgement deadline, fallback channel และ Ops Task เมื่อไม่มีผู้รับทราบ
- **INC-06** Incident record ต้องเป็น append/correct ไม่ลบหรือแก้ประวัติเดิมโดยไร้ร่องรอย
- **INC-07** การ resolve/close ต้องมี outcome, actor, timestamp และ follow-up action; incident severity สูงต้องผ่าน role ที่ policy กำหนด
- **INC-08** ข้อความทุกจุดต้องไม่ทำให้เข้าใจว่า Carespaces แทนที่บริการแพทย์ฉุกเฉิน

### 6.9 Cancellation และ replacement

- **REP-01** Customer/Provider/Admin ต้องยกเลิกผ่าน reason code และ note/evidence ตาม policy
- **REP-02** Provider cancellation ของ confirmed Assignment ต้องสร้าง Replacement Request และ Ops Task โดยอัตโนมัติเมื่อยังอยู่ใน service boundary
- **REP-03** Replacement ต้องใช้ qualification gate เดียวกับงานต้นฉบับและ pin Care Plan version ที่เหมาะสม
- **REP-04** Flow ขั้นต่ำคือ `OPEN → SEARCHING → CANDIDATE_RESERVED → CONFIRMED → HANDOVER → CLOSED` พร้อม failure/expiry path
- **REP-05** ผู้ทดแทนต้องไม่เห็นข้อมูลผู้ป่วยเต็มชุดจน confirmed และต้องได้รับ shift packet/handover ก่อนเริ่มงาน
- **REP-06** Platform แสดงว่า “เริ่มกระบวนการทันทีและพยายามจัดหาตาม SLA ของพื้นที่/เคส” ไม่รับประกันว่าหาคนได้ทุกกรณี
- **REP-07** คำขอนอก 08:00–20:00 น. ต้องถูกบันทึกและแจ้งชัดว่าไม่มี live-ops/replacement SLA
- **REP-08** หาก replacement ไม่สำเร็จ ระบบต้องแจ้ง Customer, ประเมิน cancellation/refund ตาม policy และเก็บ outcome เพื่อวัดผล

### 6.10 Completion, dispute และ review

- **DSP-01** หลัง handoff report สำเร็จ Shift อยู่สถานะรอ Customer approval จนหมด dispute window
- **DSP-02** Customer ต้องเลือก approve หรือเปิด dispute พร้อม category และรายละเอียด; evidence เพิ่มตามประเภท dispute
- **DSP-03** การเปิด dispute ต้อง pause payout ตาม policy โดยไม่แก้ ledger transaction เดิม
- **DSP-04** Dispute officer ต้องเห็น evidence timeline ที่เกี่ยวข้องและบันทึก decision/reason; refund/payout เกิน threshold ใช้ maker/checker
- **DSP-05** เมื่อ dispute ปิด ระบบต้องทำ financial adjustment แบบ idempotent และแจ้งคู่กรณีตามสิทธิ์
- **REV-01** Review เปิดได้เฉพาะ booking ที่ completed และ Customer ที่เกี่ยวข้อง
- **REV-02** ระบบต้องป้องกัน review ซ้ำและมี moderation/report mechanism
- **REV-03** Public profile แสดง aggregate ที่ผ่าน minimum sample/privacy policy; internal score ไม่เปิดโดยตรง

### 6.11 Notification, operations และ audit

- **OPS-01** ระบบต้องแจ้ง event สำคัญ ได้แก่ verification decision, invitation/reservation expiry, assignment/payment result, shift reminder/status, incident, cancellation, replacement, dispute และ payout
- **OPS-02** Notification body ต้องไม่มี diagnosis, medication, exact address, document URL หรือข้อมูลสุขภาพอ่อนไหว
- **OPS-03** Critical workflow ต้องใช้ acknowledgement/escalation ไม่ถือว่า push delivery เท่ากับผู้ใช้รับทราบ
- **OPS-04** Admin dashboard ต้องมี queue แยกตามงานและ role พร้อม owner, priority, SLA clock และ status
- **OPS-05** Manual override ต้องจำกัด capability, บังคับ reason และสร้าง audit event
- **OPS-06** State transition, sensitive read, export, payment action, verification decision, incident action และ override ต้อง trace ถึง actor/correlation ID
- **OPS-07** Admin search ต้องใช้ข้อมูลเท่าที่จำเป็นและ log การเข้าถึง Patient/clinical data

## 7. Business rules

### 7.1 Qualification precedence

```text
Safety/permission gate
→ availability and serviceability
→ clinical approval
→ ranking
→ customer choice/provider confirmation
→ payment condition
→ confirmed assignment
```

Ranking หรือ manual preference ห้ามข้าม hard gate เว้นแต่ policy ระบุ override capability ซึ่งต้องไม่อนุญาตให้ข้ามข้อจำกัดทางกฎหมาย/วิชาชีพ

### 7.2 Reservation และ schedule conflict

- Provider แสดงความสนใจหลาย Job ได้
- Provider มี reservation ที่เวลาชนกันได้ไม่เกินหนึ่งรายการ
- เมื่อ Assignment หนึ่ง confirmed ระบบต้องถอน/ปฏิเสธ candidate state ที่ชนกันอย่าง atomic
- Expiry และ grace period เป็น server-side configurable policy และต้องแสดง countdown ที่ไม่ใช้เวลาเครื่องเป็น source of truth

### 7.3 Care record integrity

- Record ที่ publish/submit แล้วไม่ hard delete จาก product flow ปกติ
- Correction อ้างอิง record เดิม ระบุผู้แก้ เวลา และเหตุผล
- Attachment ใช้ private storage และ access check ทุกครั้ง
- รูป/หลักฐานต้องมี purpose และ retention class ไม่เปิดให้ทุก role โดยอัตโนมัติ

### 7.4 Price ownership

- Rate card และ policy เป็น versioned configuration
- Customer เห็นและยอมรับ quote ก่อน payment
- Provider เห็น expected payout ก่อนยืนยันงาน
- Overtime/expense ต้องขอและอนุมัติตาม policy ไม่เพิ่มยอดจาก client ฝ่ายเดียว

## 8. Conceptual lifecycle

State machine ที่เป็น normative และ transition guard ฉบับเต็มจะอยู่ใน P03 ส่วน P02 ใช้ lifecycle ระดับผลิตภัณฑ์ดังนี้

```text
Job:
DRAFT → REVIEW_REQUIRED/OPEN → MATCHING → PROVIDER_SELECTED
→ AWAITING_PROVIDER/AWAITING_PAYMENT → CONFIRMED
→ IN_PROGRESS → AWAITING_APPROVAL → COMPLETED
                              ↘ DISPUTED
Any eligible pre-completion state → CANCELLED/EXPIRED

Assignment:
CANDIDATE → INVITED/APPLIED → RESERVED → CONFIRMED
→ CHECKED_IN → CHECKED_OUT → COMPLETED
Pre-completion → DECLINED/EXPIRED/CANCELLED/REPLACED

Payment orchestration:
CREATED → PENDING → AUTHORIZED/CAPTURED
→ RELEASE_ELIGIBLE → PAYOUT_PENDING → PAID_OUT
Failure branches: FAILED, VOIDED, PARTIALLY_REFUNDED, REFUNDED, DISPUTED

Incident:
REPORTED → ACKNOWLEDGED → TRIAGED → IN_PROGRESS
→ RESOLVED → CLOSED
```

ชื่อ state อาจปรับใน P03 แต่ต้องรักษาความหมาย auditability และ guard ตาม requirements นี้

## 9. Acceptance scenarios ระดับ end-to-end

### E2E-01 — จองงานปกติสำเร็จ

**Given** Customer มี Patient, consent/authority และ Care Plan ที่ valid และงานอยู่ในพื้นที่/เวลา pilot

**When** งานผ่าน validation, Customer เลือก qualified Provider, Provider ยืนยัน และ PSP ยืนยัน payment condition

**Then** ระบบสร้าง confirmed Assignment เพียงหนึ่งรายการ, pin quote/Care Plan/policy version, เปิด shift packet และแจ้งทั้งสองฝ่าย

### E2E-02 — Provider ไม่ผ่าน qualification

**Given** Provider ไม่มี certificate ที่ requirement บังคับหรือ credential หมดอายุ

**When** matching หรือ pre-confirmation check ทำงาน

**Then** Provider ต้องไม่อยู่ใน candidate ที่เลือกได้และระบบเก็บ reason code โดยไม่เปิดข้อมูล internal risk ที่ไม่จำเป็น

### E2E-03 — Accept พร้อมกัน

**Given** urgent broadcast มี Provider ที่ผ่านเกณฑ์หลายคนตอบพร้อมกัน

**When** ระบบ reserve candidate

**Then** มี reservation ผู้ชนะเพียงหนึ่งรายการ ผู้ที่เหลือได้รับสถานะชัดเจน และไม่มี schedule/payment ซ้ำ

### E2E-04 — ทำงานพร้อม offline checkpoint

**Given** Provider ดาวน์โหลด shift packet และ check-in online แล้ว

**When** network ขาดระหว่างบันทึก checkpoint และกลับมา sync ซ้ำ

**Then** checkpoint ถูกบันทึกครั้งเดียวด้วย `client_event_id`, original timestamps คงอยู่ และ conflict ไม่ overwrite ข้อมูลเงียบ ๆ

### E2E-05 — SOS ขณะ backend มีปัญหา

**Given** Provider อยู่ใน active Shift และ API ใช้งานไม่ได้

**When** เปิด SOS

**Then** direct-call ไป 1669/emergency contact ยังใช้ได้ แอปแจ้งข้อจำกัดชัดเจน และ draft incident พร้อม timestamp ถูกเก็บเพื่อส่งภายหลัง

### E2E-06 — Provider ยกเลิกและมีผู้ทดแทน

**Given** confirmed Provider ยกเลิกกะที่อยู่ในเวลาบริการ

**When** ระบบเปิด Replacement Request และ qualified replacement ยืนยัน

**Then** assignment เดิมถูกปิดตาม reason, assignment ใหม่ pin requirement/Care Plan ที่ valid, ผู้ทดแทนได้รับ handover และ Customer ได้รับแจ้งทุก transition สำคัญ

### E2E-07 — หา replacement ไม่สำเร็จ

**Given** ไม่มี qualified Provider รับงานก่อน deadline

**When** replacement workflow หมดเวลา

**Then** ระบบสร้าง/คง Ops Task, แจ้ง Customer ว่าไม่สำเร็จ, ใช้ cancellation/refund policy และบันทึก outcome สำหรับ metric

### E2E-08 — Auto-complete โดยไม่มี dispute

**Given** Provider check-out และส่ง handoff report ครบ

**When** Customer ไม่ตอบภายใน dispute window และไม่มี open incident/dispute

**Then** ระบบ complete งานเพียงครั้งเดียว สร้าง payout eligibility/ledger event ตาม policy และแจ้งทั้งสองฝ่าย

### E2E-09 — เปิด dispute ก่อน payout

**Given** Shift รอ approval และยังอยู่ใน dispute window

**When** Customer เปิด dispute พร้อม category/evidence

**Then** payout ถูก pause, evidence timeline พร้อมให้ role ที่มีสิทธิ์, และการตัดสินภายหลังใช้ reversing/adjusting entries ไม่แก้ ledger เดิม

### E2E-10 — Credential หมดอายุก่อนเริ่มกะ

**Given** Provider confirmed ตอน credential ยัง valid แต่ credential หมดอายุก่อน Shift

**When** pre-shift validation ทำงาน

**Then** Provider ถูกบล็อกไม่ให้เริ่มงาน, Care Ops และ Customer ได้รับแจ้ง และระบบเปิด replacement/review ตาม policy

## 10. UX และ content requirements

- Customer flow ต้องใช้ภาษาที่เข้าใจง่ายและแยก “งานดูแล” ออกจาก “เหตุฉุกเฉิน” ชัดเจน
- หน้าเลือก Provider ต้องอธิบาย qualification fit ด้วยข้อมูลที่ตรวจสอบได้ ไม่ใช้ badge คลุมเครือ
- ก่อนชำระเงินต้องแสดง provider, เวลา, ขอบเขตงาน, cancellation/refund policy, ราคา และ SLA boundary
- Provider ต้องเห็น expected activity, restriction, location ระดับพื้นที่ก่อนยืนยัน และเห็น exact shift packet หลัง confirmed
- Clinical/incident input ต้องลด free text เมื่อมี structured option แต่อนุญาต note ที่จำเป็น
- ทุก destructive/financial/clinical action ที่ย้อนกลับไม่ได้ต้องมี confirmation และผลลัพธ์ที่ชัดเจน
- Accessibility baseline: responsive, keyboard navigation สำหรับ web, readable contrast, semantic labels และ touch target ที่เหมาะกับ mobile
- ภาษา MVP คือไทย; internal code/value ใช้ภาษาอังกฤษและ UI ต้องพร้อมเพิ่มภาษาอังกฤษภายหลัง

## 11. Data, privacy และ retention requirements

- เก็บข้อมูลเท่าที่จำเป็นต่อ verification, matching, care, payment, safety และ legal obligation
- Exact address, health data, credential และ finance data ต้องแยก authorization และ encryption class
- Notification, analytics, log และ trace ห้ามมีข้อมูลสุขภาพหรือ secret
- Customer/Patient ต้องเข้าถึง privacy notice และช่องทางขอใช้สิทธิ์ข้อมูล
- Retention/deletion ต้องขับเคลื่อนด้วย data class และ legal basis; clinical/finance/audit record ไม่ใช้ hard delete แบบเดียวกับ profile content
- Production support ห้าม copy ข้อมูลจริงไป dev/staging; environment ที่ไม่ใช่ production ใช้ synthetic data

Retention duration ราย data class ต้องได้รับ DPO/Legal approval ใน Phase 0 และบันทึกใน retention matrix ก่อน pilot

## 12. Non-functional acceptance baseline

ยึดค่าจาก P01:

- Booking/care API availability target 99.9% ต่อเดือน
- API ทั่วไป p95 ต่ำกว่า 500 ms และ matching p95 ต่ำกว่า 2 วินาทีที่ candidate pool เป้าหมาย
- Live update ถึง active client ภายใน 3 วินาทีตามปกติ โดยไม่ถือเป็น delivery guarantee
- RPO ไม่เกิน 15 นาที และ RTO ไม่เกิน 2 ชั่วโมง พร้อม restore drill
- State ด้าน clinical/finance commit ใน PostgreSQL ก่อน acknowledge และ async event ใช้ outbox
- Webhook, queue consumer, scheduled action และ mobile sync ต้องรองรับ at-least-once/idempotency
- ต้องทดสอบ accessibility, authorization, concurrency, offline sync, notification failure, PSP webhook ordering และ backup restore ก่อน pilot

## 13. Release gates

### Gate A — Product/clinical ready

- Clinical policy owner อนุมัติ activity/qualification matrix
- Job/Care Plan/Incident state machine และ permission matrix ผ่าน review
- Service area, operating hours และ customer-facing SLA copy ถูกกำหนด
- Runbook สำหรับ urgent, SOS, cancellation, replacement และ dispute ผ่าน tabletop exercise

### Gate B — Legal/privacy ready

- Managed marketplace contract/liability/tax model ผ่าน review
- Consent/authority, privacy notice, retention matrix และ processor agreements พร้อม
- Payment language/flow ผ่าน Legal และไม่ใช้คำว่า escrow โดยไม่ได้รับอนุมัติ
- AWS region/data-transfer decision ผ่าน DPO review

### Gate C — Operations ready

- Care Ops roster ครอบคลุม 08:00–20:00 น. ทุกวันตามพื้นที่ pilot
- Verification, escalation, replacement และ dispute queues มี owner/backup
- Replacement/incident drill และ provider cancellation simulation ผ่าน
- PSP reconciliation, refund และ payout exception runbook ผ่าน

### Gate D — Engineering ready

- Threat model, permission tests, audit coverage และ penetration findings ระดับ critical/high ถูกปิด
- Load/concurrency, offline sync, webhook replay, DLQ replay และ restore test ผ่านเกณฑ์
- Observability/alerting ไม่มี PII/health-data leakage จาก test
- App/Web มี rollback path และ production configuration ผ่าน four-eyes review

## 14. Backlog slicing recommendation

| Slice | User-visible outcome | Core requirements |
|---|---|---|
| S1 Foundation | สมัคร ใช้สิทธิ์ และ audit ได้ | IAM-01–07, OPS-05–07 |
| S2 Provider supply | ส่งเอกสาร อนุมัติ และตั้ง availability | VER-01–07 |
| S3 Patient & job | สร้างผู้ป่วย Care Plan และ publish งาน | PAT-01–02, CARE-01–06, JOB-01–07 |
| S4 Match & book | เลือก provider, quote, payment และ confirm | MAT-01–08, PAY-01–08 |
| S5 Execute care | ดู shift, check-in, checklist, handoff | SHIFT-01–10 |
| S6 Complete & settle | approve/auto-complete, ledger และ payout | PAY-09–12, DSP-01–05, REV-01–03 |
| S7 Safety operations | incident, SOS, cancellation และ replacement | INC-01–08, REP-01–08 |
| S8 Pilot hardening | notification, ops queues, failure/DR tests | OPS-01–07 และ E2E-01–10 |

ทุก slice ต้องรวม authorization, audit, telemetry redaction, failure handling และ automated test ของ flow นั้น ไม่เลื่อนไปทำรวมท้ายโครงการ

## 15. Open validation items — ไม่ใช่ product direction decisions

| ID | Item | ต้องได้ผลลัพธ์อะไร | Owner |
|---|---|---|---|
| V-01 | Pilot service area | รายชื่อเขตและเกณฑ์ provider density/coverage | Product + Ops |
| V-02 | PSP capability | Flow จริงของ authorization/capture/void/refund/payout, webhook และ reconciliation | Legal + Finance + Engineering |
| V-03 | Pricing policy | Rate card, fee, cancellation, overtime, expense, dispute window และ payout schedule | Product + Finance |
| V-04 | Clinical activity policy | Provider type/skill/certificate/restricted activity matrix ที่ลงนามอนุมัติ | Clinical |
| V-05 | Operations SLA | Roster, acknowledgement/escalation timer และข้อความ SLA ตามพื้นที่/เคส | Ops |
| V-06 | AWS region | Service availability, quota, cost, support/DR และ DPO decision ระหว่าง Thailand/Singapore | Engineering + DPO |
| V-07 | Identity/KYC | IdP, customer verification level และ provider identity/credential sources | Product + Legal + Engineering |
| V-08 | Data governance | Consent wording, retention duration, DSR process และ cross-border controls | DPO + Legal |

รายการเหล่านี้ต้องถูกปิดด้วย policy/configuration/ADR ก่อน gate ที่เกี่ยวข้อง แต่ไม่เปลี่ยนทิศทาง MVP ที่อนุมัติใน P01

## 16. Traceability ไปยัง P01 decisions

| Decision | การนำมาใช้ใน P02 |
|---|---|
| D-01 | Managed marketplace + human Care Ops; ไม่อ้างเป็นบริการแพทย์ฉุกเฉิน |
| D-02 | Pilot เฉพาะเขตกรุงเทพฯ ที่ผ่าน serviceability/provider density |
| D-03 | เฉพาะ `APPROVED`; ตัด conditional assignment |
| D-04 | Versioned rate card และ platform-generated quote |
| D-05 | PSP-supported payment flow + ledger; ไม่ใช้ escrow |
| D-06 | รับกะ 08:00–20:00 น.; direct-call ใช้ได้ตลอด แต่นอกเวลาไม่มี replacement SLA |
| D-07 | Customer web/PWA, Provider mobile และ Admin web |
| D-08 | Thailand primary หาก spike ผ่าน; Singapore fallback; ไม่มี multi-region MVP |
| D-09 | ORM เลือกหลัง PostGIS/RLS/migration spike ไม่มีผลต่อ public product contract |
| D-10 | หนึ่ง Job/หนึ่ง Shift; ไม่มี recurring/long-term contract |

---

### Recommended next artifact

สร้าง `p03-domain-model.md` เพื่อกำหนด entity, normative state machines, transition guards, permission matrix, domain events และ invariants โดยใช้ requirement ID ใน P02 เป็น traceability key
