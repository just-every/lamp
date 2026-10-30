# Sorry public capture verification

Test-environment key, not a production-trusted issuer. Public Sorry source; no subscribers.

Environment: test. The environment boundary is the consumer's independent issuer key store; the vendored schema has no environment field. Production must not pin this test key.

Input: sha256 5fa468f3b500e690b3213c1d3ed1fbbe149c9f8222e4a94088341803e5e86a50, 135579 bytes (exact uploaded JSON envelope of unchanged response text, sorted by filename).
Origin: https://status.chargedesk.com
Captured at: 2026-10-30T02:24:16.948Z
Format: sorry-public-v1-saved-responses
Candidate and adapter revision: c2e267833ef8febd13bfec9c01c2dd70d12a1334
Mapping SHA-256: 1e96bfa73c60ad8ed2b5afad3e5184cd979094c961ff7ad79165b545bef64d04

Source/native counts (updates are nested native timeline rows):

```json
{
  "source": {
    "group": 2,
    "component": 16,
    "incident": 28,
    "maintenance": 2,
    "updates": 63
  },
  "native": {
    "group": 2,
    "component": 16,
    "incident": 28,
    "maintenance": 2,
    "updates": 63
  }
}
```

Dry-run and apply accounting (includes one source metadata effect):

```json
{
  "byKind": {
    "component": 16,
    "group": 2,
    "incident": 28,
    "maintenance": 2,
    "metadata": 1
  },
  "duplicates": 0,
  "effects": 49,
  "input": 49,
  "mapped": 49,
  "rejected": 0,
  "unique": 49,
  "unmapped": 2
}
```

Mapping policy:

Lamp Move in mapping v1: Sorry groups and components retain order and source identity; notice messages and publication times map to native incident or maintenance history. Source lifecycle and field transformations are named by the reviewed accounting report. Public captures have no subscribers. Every mapped source entity is one atomic native target with retained source/artifact provenance; import sends no notifications.

Unmapped / not carried: every door explanation below is a named loss; raw source responses are not published. Public capture has no subscriber export, invitations, private notices, RSS/Atom archive or production cutover proof.

```json
{
  "unmapped": {
    "count": 2,
    "itemManifestSha256": "f9a4e9d07396d9b037e33478f674c6e1c0858a4a21719df37726dccc61df49f4",
    "items": [
      {
        "sourceIdentitySha256": "6bdf45f01fab955eaa4d5a1a9a0a7f837344c9934a3fb76cc5a86d5febd13ea1",
        "sourceKind": "group",
        "fields": [
          "group"
        ]
      },
      {
        "sourceIdentitySha256": "707ea252d521df8cc357feeecc577ec8eaf296e1f38cac127dd8f214128774bc",
        "sourceKind": "group",
        "fields": [
          "group"
        ]
      }
    ]
  },
  "explanations": [
    {
      "kind": "group",
      "sourceId": "2585",
      "reason": "Group and its order carried over. Sorry parent is retained as a component and as its children's visual group."
    },
    {
      "kind": "group",
      "sourceId": "2594",
      "reason": "Group and its order carried over. Sorry parent is retained as a component and as its children's visual group."
    }
  ]
}
```

Source/native manifest comparison with independently read provenance (sorted hashed descriptors, no source text):

```json
{
  "reconciliation": {
    "rows": {
      "sourceCount": 49,
      "targetCount": 49,
      "sourceManifestSha256": "44f1c6ec1bfa3ba9473ffdff4014e6b7e4409b4ff5cf11feb0a5c3946f8899b6",
      "targetManifestSha256": "44f1c6ec1bfa3ba9473ffdff4014e6b7e4409b4ff5cf11feb0a5c3946f8899b6"
    },
    "provenance": {
      "sourceCount": 49,
      "targetCount": 49,
      "sourceManifestSha256": "b929e90b0d0e1061bbe347511a702b739359eacda7a3d0fcd0957a1170cfe131",
      "targetManifestSha256": "b929e90b0d0e1061bbe347511a702b739359eacda7a3d0fcd0957a1170cfe131"
    },
    "attachments": {
      "sourceCount": 0,
      "targetCount": 0,
      "sourceManifestSha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "targetManifestSha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    }
  },
  "manifests": {
    "rows": {
      "source": [
        "039328f11fd975656ba087afe3f3f8cd3bfd0c0b23499cd860b6a3f3ff8bb97b",
        "04c061040cacab984592def0ed8e3158e247f06e33250a7fca08959b58c29ebe",
        "06e903b118ee12d5d35a461b8725020073f2e1affdfbd52fca7dbfbe37e5a472",
        "080cd2d6ba6fec7cdf0e998e580781e21132f07e8a16ec800de7f279d9fceb30",
        "0f240c5a478e88cde6cfd9fa95705f3ff0c75995c4dcf1dcafdfbc522363b40a",
        "12e07a67cb93bd5d8793b9eed217eb6938af78c10293a8caa3ca94791f2ad6e7",
        "14bc46cfbe7a3e30bf9bb04e7049399b90dd9924e47be5ce9b8778efd7bcb19a",
        "1f8cc5f0456692a3950fc7a06a7946b5bd76e40592f0ced643e97196c6a9cb4a",
        "229d7921e6e5a7366f3adf151350fd10c234dabbc6eb09cb15de55d0dc9cbd1b",
        "2bb7bdbc44b464a7b22a9fa6f1c9b23cca423c10a81cf4a3df2948533e12f584",
        "2e52fb5dec966fc61702127376d080e8ac24849bd8d0a272e17fb317e3fcedbc",
        "34898647940dcce7da0f93a3df05e0e24eb3be5c506354e509ef07680c77d0de",
        "3ac6775fb92a47e7f48039b3b7580f39545e0103e2dae295510d15752212d503",
        "4ba1a15f8854203b48a0f6d4050774041bb9834a1517fcb3757bac89b03e3969",
        "4e01946954e28c8e3b1d94b6b8a4dd1b189d7b05d811462eb2758220a65ebe2a",
        "55a5c7ec5f1ba3979868ab5c61b860b55a6893fa42806deaec0926e3c540aea1",
        "56a676708110aef3cb992f7c0ecd3ae293df7aadaabe37d01f0ead73dfce2ba2",
        "579160618c9f29395c53f5052824d187799989ed6b9d0c05943e5491cb4bd460",
        "5892417125f8556542612c62b0fa89bde57f0e5342f5f8f5d2441848ba216394",
        "5cf2664b839019ecf3e6f27b2378427eb0a551a23c85ca062a380461493cb40c",
        "5f453e9fd01f70b582f6cca1a90be725f959ac7118995e2a295ad6802b37417b",
        "6798681a3d3681b184497367484f6780f70f0e3baea77140e17bd9337cab0b72",
        "67a196a35a37a6fbe370d996b0e5345f9b8a0d7bde28056c2c6d24db38b0ed09",
        "68ba8c093299bf33dd077592b83026d236d1f64536befb4b715f38828a9f053e",
        "6d8a1636d830c2aeef5ce23e785c0c5042785bd3a8ee78ab40973d201919f4dc",
        "6efcd9d047be70132b2b0a8f44cde78002b50d82fadb5acdbfd51ba9c9b7f506",
        "78281f2995a42645fe2aef88a0531276a2b205ca8fa4b6ff755faa2aa1fd8450",
        "7b53207c61d9b2b9dbbfce2279e7c2823110ad1302e40940b805e8368c898e40",
        "7c92799fed2d06be479a7f8987fa5c6d96f41927671a1f10d739e5fec7598e08",
        "85612975e9760c4149ccf0c823596b8e1e7d69a7690ddbeec0c2628e5a42708a",
        "913e3f1de6dc97a045198d769e544aa745d1bf759c7695c111e3e4d7c8bc66ee",
        "a1c36ee73b368fddb3144db7b8b882f5f0dc577e1d8d137a6b9a80f66e2adc9a",
        "a6a19193b6349ee2ad0b547580ea5b29f3eaa569aa559a25f9834218990ddfef",
        "a733c69e6364588e18395563babd0be93f545c292b47a89b18d3ada44094e5cf",
        "a79146e62f2a2ad791866bebb4ecc29857301694101ca2582a7b9858eba19f27",
        "a8ee331ed40ed927f43ee485fc1dbbe04f3f50e6ac6a4af3cf75b13520543d0b",
        "af8b2d6801483d61686558fde643a9ae73b9e4c43fc74a91990f8c6a0aa19010",
        "b5efbf1fd86d04a7364610eebbd23d766b9ebfcb2da5c8161796cb7f1f0a81e0",
        "caa29ab7097dd15bec777e8e6129660a05c108d949646b732d4cb35f7bbdb167",
        "da5d9d3df609806aba54b7748be2ae98a4b6e2d229f5a26a5669544228b7543f",
        "dadecaf1e915ad04756e49894433484c66f780b42f22715df0209df6245a348b",
        "db9cea802425e488864d0a9fd6f18afc5492bb72fb9a010cc2f57e366f07fa23",
        "dcd9ece83c3d59a26e2bbed2790bd23fd7ee26d314635c13341aaf5809e4dfe1",
        "e76341d25ae630d86d5717aca0e5e700d8ccdea665d0ef3658be13ad2604d836",
        "ebe15ad2033b837b171ecb93035647310c0f6ec18d0517ae422bf42a04bd6483",
        "f4ce2c88362def11c2a838e90640f9bcc7e617eb139b22ded010e242f011cde0",
        "f6f3cb1e3dbd0b62ffbbc683a4de0ee223cf934086b5ce474ef6222c984bba71",
        "feda8d3d7f1612ac9e48e63fbdf084542da8e4df63bfe7c36868d9c9953d966f",
        "ffb0cbdf163ef77b89032c890b4ef0ec6aa9c5cd67005947f773001b27312bad"
      ],
      "target": [
        "039328f11fd975656ba087afe3f3f8cd3bfd0c0b23499cd860b6a3f3ff8bb97b",
        "04c061040cacab984592def0ed8e3158e247f06e33250a7fca08959b58c29ebe",
        "06e903b118ee12d5d35a461b8725020073f2e1affdfbd52fca7dbfbe37e5a472",
        "080cd2d6ba6fec7cdf0e998e580781e21132f07e8a16ec800de7f279d9fceb30",
        "0f240c5a478e88cde6cfd9fa95705f3ff0c75995c4dcf1dcafdfbc522363b40a",
        "12e07a67cb93bd5d8793b9eed217eb6938af78c10293a8caa3ca94791f2ad6e7",
        "14bc46cfbe7a3e30bf9bb04e7049399b90dd9924e47be5ce9b8778efd7bcb19a",
        "1f8cc5f0456692a3950fc7a06a7946b5bd76e40592f0ced643e97196c6a9cb4a",
        "229d7921e6e5a7366f3adf151350fd10c234dabbc6eb09cb15de55d0dc9cbd1b",
        "2bb7bdbc44b464a7b22a9fa6f1c9b23cca423c10a81cf4a3df2948533e12f584",
        "2e52fb5dec966fc61702127376d080e8ac24849bd8d0a272e17fb317e3fcedbc",
        "34898647940dcce7da0f93a3df05e0e24eb3be5c506354e509ef07680c77d0de",
        "3ac6775fb92a47e7f48039b3b7580f39545e0103e2dae295510d15752212d503",
        "4ba1a15f8854203b48a0f6d4050774041bb9834a1517fcb3757bac89b03e3969",
        "4e01946954e28c8e3b1d94b6b8a4dd1b189d7b05d811462eb2758220a65ebe2a",
        "55a5c7ec5f1ba3979868ab5c61b860b55a6893fa42806deaec0926e3c540aea1",
        "56a676708110aef3cb992f7c0ecd3ae293df7aadaabe37d01f0ead73dfce2ba2",
        "579160618c9f29395c53f5052824d187799989ed6b9d0c05943e5491cb4bd460",
        "5892417125f8556542612c62b0fa89bde57f0e5342f5f8f5d2441848ba216394",
        "5cf2664b839019ecf3e6f27b2378427eb0a551a23c85ca062a380461493cb40c",
        "5f453e9fd01f70b582f6cca1a90be725f959ac7118995e2a295ad6802b37417b",
        "6798681a3d3681b184497367484f6780f70f0e3baea77140e17bd9337cab0b72",
        "67a196a35a37a6fbe370d996b0e5345f9b8a0d7bde28056c2c6d24db38b0ed09",
        "68ba8c093299bf33dd077592b83026d236d1f64536befb4b715f38828a9f053e",
        "6d8a1636d830c2aeef5ce23e785c0c5042785bd3a8ee78ab40973d201919f4dc",
        "6efcd9d047be70132b2b0a8f44cde78002b50d82fadb5acdbfd51ba9c9b7f506",
        "78281f2995a42645fe2aef88a0531276a2b205ca8fa4b6ff755faa2aa1fd8450",
        "7b53207c61d9b2b9dbbfce2279e7c2823110ad1302e40940b805e8368c898e40",
        "7c92799fed2d06be479a7f8987fa5c6d96f41927671a1f10d739e5fec7598e08",
        "85612975e9760c4149ccf0c823596b8e1e7d69a7690ddbeec0c2628e5a42708a",
        "913e3f1de6dc97a045198d769e544aa745d1bf759c7695c111e3e4d7c8bc66ee",
        "a1c36ee73b368fddb3144db7b8b882f5f0dc577e1d8d137a6b9a80f66e2adc9a",
        "a6a19193b6349ee2ad0b547580ea5b29f3eaa569aa559a25f9834218990ddfef",
        "a733c69e6364588e18395563babd0be93f545c292b47a89b18d3ada44094e5cf",
        "a79146e62f2a2ad791866bebb4ecc29857301694101ca2582a7b9858eba19f27",
        "a8ee331ed40ed927f43ee485fc1dbbe04f3f50e6ac6a4af3cf75b13520543d0b",
        "af8b2d6801483d61686558fde643a9ae73b9e4c43fc74a91990f8c6a0aa19010",
        "b5efbf1fd86d04a7364610eebbd23d766b9ebfcb2da5c8161796cb7f1f0a81e0",
        "caa29ab7097dd15bec777e8e6129660a05c108d949646b732d4cb35f7bbdb167",
        "da5d9d3df609806aba54b7748be2ae98a4b6e2d229f5a26a5669544228b7543f",
        "dadecaf1e915ad04756e49894433484c66f780b42f22715df0209df6245a348b",
        "db9cea802425e488864d0a9fd6f18afc5492bb72fb9a010cc2f57e366f07fa23",
        "dcd9ece83c3d59a26e2bbed2790bd23fd7ee26d314635c13341aaf5809e4dfe1",
        "e76341d25ae630d86d5717aca0e5e700d8ccdea665d0ef3658be13ad2604d836",
        "ebe15ad2033b837b171ecb93035647310c0f6ec18d0517ae422bf42a04bd6483",
        "f4ce2c88362def11c2a838e90640f9bcc7e617eb139b22ded010e242f011cde0",
        "f6f3cb1e3dbd0b62ffbbc683a4de0ee223cf934086b5ce474ef6222c984bba71",
        "feda8d3d7f1612ac9e48e63fbdf084542da8e4df63bfe7c36868d9c9953d966f",
        "ffb0cbdf163ef77b89032c890b4ef0ec6aa9c5cd67005947f773001b27312bad"
      ]
    },
    "provenance": {
      "source": [
        "0899575871874f981c60c20c377a466b6115a102d5d085395d495c89518acbd5",
        "0b3622359fc3209a7aa0943ea8992cd7c0acad2708a4794c48e59b175edf6ca0",
        "0bb6b89b6ed580fe554dde8746be6908400f29e491330b576bbd7d2200dfcc29",
        "12628e6a9d9419bfc955b3ba0825520b182e77cec3590b190e28533da3c2d328",
        "14b1442d126ee13661efc0c1be1aad64a924b55bf6c35d281e4030467ec72825",
        "15c8b63e949775297f6438b5ab0b2c231525024697878a944d7e188c3aa2eb67",
        "1a716789fb18fbc50a329634b2d9621b8308fad4b62976b4483285d3efa1a6fb",
        "1f8f58a5aab303e02bfc27c215f03eaa3b8a21accb16dd2d848448cc6d514a46",
        "215d7fccd87ea9ece5c45b539b38e370b1ecbc686636a1707141a2008fbb0a5d",
        "247ed51818287d1d0ba9c97670a87a729b527c8248fd87e6c34189339434249b",
        "29043adbf58cfa6feeecae60993340a05d18e2087f96c5467caceec75e6a8f9f",
        "2c70219c736775cc3c705e85d7ad21917fd8ae33f109a0d208d5e9e44b7b81eb",
        "2d3fd37bccadc493065ac56a8ea4bf80f7868baa73c11774a550168b3860cb7b",
        "300e2ac50799f1b82b0d67c3a979d6ace1edf0b507d4c4ad0f209395cb046d9f",
        "339bda118b4c8b5f56e10ad5f4f3ba12f73efd063f0b1268ccf128c742582a7a",
        "3e9c71a922d016154451bc1c00a7317aa163de08dd89c137dd867fccb5e04e99",
        "4129930e70b10a0245d700df08d3e5d4cba0a8aa35a5534532c2944e684e2151",
        "484415af31e276ac84d6ee76a0ca70267b332093b3cb4bb5a8405e1e8c04d6f9",
        "4d1454fc6eeae7106d1fc3951f7159302f76965eb13cc2f3016509a297fba95b",
        "60039b88b59d7d6467c320cc92ace53b63c9896392407a0b47f07da4b967ad9e",
        "618ea03dea39c8b09a9200a147c029a6db1292561c27818e6206a1b883ec8b4a",
        "67b784b7dd31e8554f4efa3c30fb930c66475a893c2ece421c71eec2564a6b6b",
        "6df45ca5ed9fe86c994257708f60324eb8ba90424e49e9d00497766f2f6f368a",
        "72d2e4431fd9cbe8abf9780d949782572fb082aaf0653ce5a820ccff4646d68d",
        "766fc8f16cfa762b72ee65c6831f14a6bd2562c0363569bf6da27196e6d00251",
        "7a7473fccab8c039a3786a7418df12099326b0586296fab5abae1fa411bcda2f",
        "83642c27929f09b92fce35f440fe1882ccf3aac34d9d0593e4a545b11dcce150",
        "84a6023adfa57ea97e91b5ec4463a9de5b727aa94039582ce8ae2a798389c67b",
        "873d3c3cde54d128e08c445af9f7f474572c8cee268f28db9f1e8dab80f18410",
        "99eb6fa92d0d37747267f14ac0f7883dc1e63b6662f3800da41c4187e579d8fe",
        "a19ba79423458fe3a477e782f53f43df45327e407f38d6b850319b0ce240e907",
        "a3bf37616ac1a5f9861ecd5d760b4074bdf472ad774f2bdf7bc1f67d43ff9583",
        "a6643db7f3eb07c3f9535fdd1f2577cc779531a8f36aa07650543c0bd08231c4",
        "a856c6d47df9faedc2b420a69c45f2eb76bf1cae34348ab3a2de014f46548730",
        "ad9bd734a35f04e329a6ff870006e6ed44bcf5a8eefae5d54e8c9736a41479e7",
        "af7ccf648d42890315433dd1c2a3a5d51ef9eef1ed0a3fd903e213e3f2e6c511",
        "b26f0488ed496bdef56cabb473ec3d95d8a4460794afd1a7cb58802925959d36",
        "b573fc627f18bbb7bb7016f63a13510110a1c9aa651943c454d61dcb5117dac1",
        "c408ac8df450e7f530c04b75335a950af2915aac098e3324db6fa868ada9279f",
        "c46abe8bb3562c33f46513ffb95ff73f4f0cf3f6ad546869c724ac38826482d5",
        "c94680561dd318fe25b94391611a9054f2615a2b2619940488f705f74a0232c4",
        "d3b2b519d44523661f1b91cbd42498c5b39087c0464acc25f2e99b1cf45c933f",
        "e001eaa096e0ad4b684f0212d2119ae5eab505769d412c941155a7db86372332",
        "e153c00c465192288e671d4113f08418ca2ab651b46db36436e8b7c792ffe8db",
        "ef15eea8db980d24ed00fce29dd03423ed9badb0a454b0acf96badc485af96be",
        "f0fee8d858f87cee274c541a8a4f1546fc21166cef5414f7f51cca144fb746ed",
        "f31944abfe4f84f45e403f8a43489bdf531fbc09a755188f430d4f633e3104a3",
        "fe1e33e3ffaa0b2b150fe48c13ec2193caa803b289779b35f4a3522b0504eff4",
        "feaa872bd8587ba0892973e0e4c8d64460b65b32374ca10e670af662443d83a0"
      ],
      "target": [
        "0899575871874f981c60c20c377a466b6115a102d5d085395d495c89518acbd5",
        "0b3622359fc3209a7aa0943ea8992cd7c0acad2708a4794c48e59b175edf6ca0",
        "0bb6b89b6ed580fe554dde8746be6908400f29e491330b576bbd7d2200dfcc29",
        "12628e6a9d9419bfc955b3ba0825520b182e77cec3590b190e28533da3c2d328",
        "14b1442d126ee13661efc0c1be1aad64a924b55bf6c35d281e4030467ec72825",
        "15c8b63e949775297f6438b5ab0b2c231525024697878a944d7e188c3aa2eb67",
        "1a716789fb18fbc50a329634b2d9621b8308fad4b62976b4483285d3efa1a6fb",
        "1f8f58a5aab303e02bfc27c215f03eaa3b8a21accb16dd2d848448cc6d514a46",
        "215d7fccd87ea9ece5c45b539b38e370b1ecbc686636a1707141a2008fbb0a5d",
        "247ed51818287d1d0ba9c97670a87a729b527c8248fd87e6c34189339434249b",
        "29043adbf58cfa6feeecae60993340a05d18e2087f96c5467caceec75e6a8f9f",
        "2c70219c736775cc3c705e85d7ad21917fd8ae33f109a0d208d5e9e44b7b81eb",
        "2d3fd37bccadc493065ac56a8ea4bf80f7868baa73c11774a550168b3860cb7b",
        "300e2ac50799f1b82b0d67c3a979d6ace1edf0b507d4c4ad0f209395cb046d9f",
        "339bda118b4c8b5f56e10ad5f4f3ba12f73efd063f0b1268ccf128c742582a7a",
        "3e9c71a922d016154451bc1c00a7317aa163de08dd89c137dd867fccb5e04e99",
        "4129930e70b10a0245d700df08d3e5d4cba0a8aa35a5534532c2944e684e2151",
        "484415af31e276ac84d6ee76a0ca70267b332093b3cb4bb5a8405e1e8c04d6f9",
        "4d1454fc6eeae7106d1fc3951f7159302f76965eb13cc2f3016509a297fba95b",
        "60039b88b59d7d6467c320cc92ace53b63c9896392407a0b47f07da4b967ad9e",
        "618ea03dea39c8b09a9200a147c029a6db1292561c27818e6206a1b883ec8b4a",
        "67b784b7dd31e8554f4efa3c30fb930c66475a893c2ece421c71eec2564a6b6b",
        "6df45ca5ed9fe86c994257708f60324eb8ba90424e49e9d00497766f2f6f368a",
        "72d2e4431fd9cbe8abf9780d949782572fb082aaf0653ce5a820ccff4646d68d",
        "766fc8f16cfa762b72ee65c6831f14a6bd2562c0363569bf6da27196e6d00251",
        "7a7473fccab8c039a3786a7418df12099326b0586296fab5abae1fa411bcda2f",
        "83642c27929f09b92fce35f440fe1882ccf3aac34d9d0593e4a545b11dcce150",
        "84a6023adfa57ea97e91b5ec4463a9de5b727aa94039582ce8ae2a798389c67b",
        "873d3c3cde54d128e08c445af9f7f474572c8cee268f28db9f1e8dab80f18410",
        "99eb6fa92d0d37747267f14ac0f7883dc1e63b6662f3800da41c4187e579d8fe",
        "a19ba79423458fe3a477e782f53f43df45327e407f38d6b850319b0ce240e907",
        "a3bf37616ac1a5f9861ecd5d760b4074bdf472ad774f2bdf7bc1f67d43ff9583",
        "a6643db7f3eb07c3f9535fdd1f2577cc779531a8f36aa07650543c0bd08231c4",
        "a856c6d47df9faedc2b420a69c45f2eb76bf1cae34348ab3a2de014f46548730",
        "ad9bd734a35f04e329a6ff870006e6ed44bcf5a8eefae5d54e8c9736a41479e7",
        "af7ccf648d42890315433dd1c2a3a5d51ef9eef1ed0a3fd903e213e3f2e6c511",
        "b26f0488ed496bdef56cabb473ec3d95d8a4460794afd1a7cb58802925959d36",
        "b573fc627f18bbb7bb7016f63a13510110a1c9aa651943c454d61dcb5117dac1",
        "c408ac8df450e7f530c04b75335a950af2915aac098e3324db6fa868ada9279f",
        "c46abe8bb3562c33f46513ffb95ff73f4f0cf3f6ad546869c724ac38826482d5",
        "c94680561dd318fe25b94391611a9054f2615a2b2619940488f705f74a0232c4",
        "d3b2b519d44523661f1b91cbd42498c5b39087c0464acc25f2e99b1cf45c933f",
        "e001eaa096e0ad4b684f0212d2119ae5eab505769d412c941155a7db86372332",
        "e153c00c465192288e671d4113f08418ca2ab651b46db36436e8b7c792ffe8db",
        "ef15eea8db980d24ed00fce29dd03423ed9badb0a454b0acf96badc485af96be",
        "f0fee8d858f87cee274c541a8a4f1546fc21166cef5414f7f51cca144fb746ed",
        "f31944abfe4f84f45e403f8a43489bdf531fbc09a755188f430d4f633e3104a3",
        "fe1e33e3ffaa0b2b150fe48c13ec2193caa803b289779b35f4a3522b0504eff4",
        "feaa872bd8587ba0892973e0e4c8d64460b65b32374ca10e670af662443d83a0"
      ]
    },
    "attachments": {
      "source": [],
      "target": []
    }
  },
  "differences": {
    "rows": 0,
    "provenance": 0,
    "attachments": 0,
    "revisions": 0
  },
  "unexplainedDifferences": 0
}
```

Notification activity: {"outbox":0,"deliveries":0,"invitations":0}.

Undo: undone; initial native state restored exactly through owner HTTP reads. Plan wrote zero native records; apply used the exact reviewed fingerprint. No subscriber data was supplied and no invitations were requested.

Capture request list (34 GETs; 16124 ms; no retries):

- GET /api/v1/status -> 200
- GET /api/v1/components -> 200
- GET /api/v1/notices -> 200
- GET /api/v1/notices?page=2 -> 200
- GET /api/v1/notices/507847 -> 200
- GET /api/v1/notices/501729 -> 200
- GET /api/v1/notices/496488 -> 200
- GET /api/v1/notices/496485 -> 200
- GET /api/v1/notices/496483 -> 200
- GET /api/v1/notices/496480 -> 200
- GET /api/v1/notices/493810 -> 200
- GET /api/v1/notices/493809 -> 200
- GET /api/v1/notices/493808 -> 200
- GET /api/v1/notices/493805 -> 200
- GET /api/v1/notices/493804 -> 200
- GET /api/v1/notices/473799 -> 200
- GET /api/v1/notices/471453 -> 200
- GET /api/v1/notices/471414 -> 200
- GET /api/v1/notices/471381 -> 200
- GET /api/v1/notices/471366 -> 200
- GET /api/v1/notices/468773 -> 200
- GET /api/v1/notices/452447 -> 200
- GET /api/v1/notices/438427 -> 200
- GET /api/v1/notices/409177 -> 200
- GET /api/v1/notices/395026 -> 200
- GET /api/v1/notices/394943 -> 200
- GET /api/v1/notices/393965 -> 200
- GET /api/v1/notices/391662 -> 200
- GET /api/v1/notices/388678 -> 200
- GET /api/v1/notices/386389 -> 200
- GET /api/v1/notices/386382 -> 200
- GET /api/v1/notices/368734 -> 200
- GET /api/v1/notices/368728 -> 200
- GET /api/v1/notices/287257 -> 200

Test public key, keyId lamp-test-20261030:

```text
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKGe5BkcylNQiDkCI6uq39x0b9ZLtx+4ciiiznc7Ojc0=
-----END PUBLIC KEY-----
```
