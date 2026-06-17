# Backend — Required Task Output

Setiap task backend laporkan dalam urutan ini:
1. Fact (apa yang benar dari repo/runtime)
2. Assumption
3. Mismatch / Needs Verification
4. Risk
5. Files/area terdampak
6. Verification plan (perintah nyata: npm run lint / npm test / smoke)
7. Docs/ADR update note (bila menyentuh area kontrak)
8. PR/review note

Definition of Done = diff/PR + verifikasi segar + review verdict. Kurang satu = Needs Verification.
