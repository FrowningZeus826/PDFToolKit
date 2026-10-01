import sys, json, warnings
warnings.filterwarnings('ignore')
from pyhanko.sign import signers
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pyhanko.keys import load_cert_from_pemder
cmd = sys.argv[1]
if cmd == 'sign':
    src, dst, key, cert = sys.argv[2:6]
    s = signers.SimpleSigner.load(key, cert)
    with open(src, 'rb') as f:
        out = signers.sign_pdf(IncrementalPdfFileWriter(f), signers.PdfSignatureMetadata(field_name='ExtSig'), signer=s)
        open(dst, 'wb').write(out.getbuffer())
    print('signed')
elif cmd == 'validate':
    f, trust = sys.argv[2:4]
    r = PdfFileReader(open(f, 'rb'))
    res = []
    for sig in r.embedded_signatures:
        st = validate_pdf_signature(sig, ValidationContext(trust_roots=[load_cert_from_pemder(trust)]))
        res.append({'field': sig.field_name, 'intact': st.intact, 'valid': st.valid, 'trusted': st.trusted, 'coverage': str(st.coverage), 'md': st.md_algorithm, 'signer': st.signing_cert.subject.human_friendly})
    print(json.dumps(res))
