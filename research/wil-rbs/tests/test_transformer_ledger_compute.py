"""Source-shape fixtures are software tests, not scientific evidence."""
from __future__ import annotations
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wil_rbs import ContractError,validate
from wil_rbs_transformer import import_langbase107
from wil_rbs_ledger import append_manifest,load,GENESIS
from wil_rbs_compute import audit_partial
from wil_rbs_paired import paired_language
from wil_rbs_ingest import import_langdepth106
from test_ingest_frontier import source_fixture

DIG='a'*64
CK=['1'*64,'2'*64,'3'*64]

def upstream_fixture():
    audit={'schema':'langbase107.independent-result-audit.v1','checks_passed':35,
           'qualification':'independent arithmetic and artifact-integrity audit; no independent scientific attestation or complete FLOP certification',
           'source_head_sha':'1'*40,'workflow_run_id':41239984498,
           'checkpoint_sha256':{str(seed):CK[i] for i,seed in enumerate((10601,10602,10603))},
           'original_artifacts':[{'name':f'LANGBASE107-fit-{s}-attempt-1','zip_sha256':DIG} for s in (10601,10602,10603)]+
                                 [{'name':'LANGBASE107-final-evaluation-attempt-1','zip_sha256':DIG}]}
    scores=[]
    for i,seed in enumerate((10601,10602,10603)):
        row={'seed':seed,'checkpoint_sha256':CK[i],
             'resources':{'carried_tensor_bytes':524288,'decode_bytes_per_second_median':500+i}}
        for mode in ('dev_reset','dev_carry','test_reset','test_carry'):
            row[mode]={'targets':55769,'nll_nats':1.7+0.01*i,'accuracy':0.5}
        scores.append(row)
    source={'schema':'langbase107.owner-final-evaluation.v1','status':'THREE_TRANSFORMER_FITS_POSTHOC_EVALUATED_EXPLORATORY',
            'independently_qualified':False,'architecture_superiority_eligible':False,
            'source_sha256':'86c4e6aa9db7c042ec79f339dcb96d42b0075e16b8fc2e86bf0ca57e2dc565ed',
            'transformer':{'parameters':998816,'carried_tensor_bytes':524288,'mean_test_reset_nll_nats':1.71},
            'runs':scores}
    return source,audit

class TransformerImportTests(unittest.TestCase):
    def test_three_runs_three_checkpoints_24_evaluations(self):
        source,audit=upstream_fixture();m=import_langbase107(source,audit)
        self.assertEqual(validate(m)['counts'],{'run':3,'checkpoint':3,'evaluation':24,'historical_aggregate':0})
        runs=[r for r in m['records'] if r['kind']=='run']
        self.assertTrue(all(r['resources']['wall_seconds'] is None for r in runs))
        self.assertTrue(all(r['resources']['training_flops']['value'] is None for r in runs))
        self.assertTrue(all(r['data']['sample_order_sha256'] is None for r in runs))
        self.assertTrue(all(r['evidence']['level']=='reported' for r in m['records']))
    def test_checkpoint_audit_disagreement_fails(self):
        source,audit=upstream_fixture();source['runs'][0]['checkpoint_sha256']='9'*64
        with self.assertRaises(ContractError):import_langbase107(source,audit)
    def test_aggregate_disagreement_fails(self):
        source,audit=upstream_fixture();source['transformer']['mean_test_reset_nll_nats']=1.5
        with self.assertRaises(ContractError):import_langbase107(source,audit)
    def test_inconsistent_scored_target_count_fails(self):
        source,audit=upstream_fixture();source['runs'][0]['test_reset']['targets']=4
        with self.assertRaises(ContractError):import_langbase107(source,audit)

    def test_recovered_original_receipts_checkpoints_and_times(self):
        root=Path(__file__).resolve().parents[1]/'examples'/'upstream'
        results=json.loads((root/'langbase107_RESULT.json').read_text())
        audit=json.loads((root/'langbase107_AUDIT.json').read_text())
        receipts=json.loads((root/'langbase107_FIT_RECEIPTS.json').read_text())
        out=import_langbase107(results,audit,fit_receipts=receipts)
        self.assertEqual(validate(out)['counts'],{'run':3,'checkpoint':15,'evaluation':24,'historical_aggregate':0})
        runs=sorted((x for x in out['records'] if x['kind']=='run'),key=lambda r:r['seed'])
        self.assertAlmostEqual(runs[0]['resources']['wall_seconds'],277.184384993)
        self.assertAlmostEqual(runs[1]['resources']['wall_seconds'],344.644581621)
        self.assertAlmostEqual(runs[2]['resources']['wall_seconds'],353.240373199)
        self.assertTrue(all(x['resources']['training_flops']['value'] is None for x in runs))
        self.assertTrue(all(x['data']['sample_order_sha256'] is not None for x in runs))
        self.assertTrue(all(x['evidence']['level']=='reported' for x in out['records']))
        broken=copy.deepcopy(receipts)
        broken['cohort'][0]['fit_receipt']['checkpoint_sha256']='9'*64
        with self.assertRaises(ContractError):import_langbase107(results,audit,fit_receipts=broken)
        tampered=copy.deepcopy(receipts)
        tampered['cohort'][0]['fit_receipt']['wall_seconds']=9999999
        with self.assertRaises(ContractError):import_langbase107(results,audit,fit_receipts=tampered)
        tampered=copy.deepcopy(receipts)
        tampered['cohort'][0]['raw_fit_receipt_b64']='QQ=='
        with self.assertRaises(ContractError):import_langbase107(results,audit,fit_receipts=tampered)

class LedgerTests(unittest.TestCase):
    def test_append_export_verify_and_idempotence(self):
        m=import_langbase107(*upstream_fixture())
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'events.jsonl'
            self.assertEqual(load(p),([],GENESIS))
            out=append_manifest(p,m);self.assertEqual(out['added'],30)
            rows,head=load(p);self.assertEqual(len(rows),30)
            self.assertEqual(head,out['head_sha256'])
            again=append_manifest(p,m,idempotent=True)
            self.assertEqual(again['added'],0);self.assertEqual(again['existing_identical'],30)
    def test_conflicting_existing_id_rejected(self):
        m=import_langbase107(*upstream_fixture())
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'events.jsonl';append_manifest(p,m)
            altered=copy.deepcopy(m);altered['records'][0]['resources']['wall_seconds']=999
            with self.assertRaises(ContractError):append_manifest(p,altered,idempotent=True)
    def test_truncation_and_modified_event_detected(self):
        m=import_langbase107(*upstream_fixture())
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'events.jsonl';append_manifest(p,m)
            data=p.read_bytes();p.write_bytes(data[:-1])
            with self.assertRaises(ContractError):load(p)
            p.write_bytes(data.replace(b'"index":1,',b'"index":2,',1))
            with self.assertRaises(ContractError):load(p)
    def test_invalid_parent_prevents_partial_append(self):
        m=import_langbase107(*upstream_fixture())
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'events.jsonl'
            bad=copy.deepcopy(m);bad['records']=[bad['records'][1]]
            with self.assertRaises(ContractError):append_manifest(p,bad)
            self.assertEqual(load(p),([],GENESIS))

class ComputeTests(unittest.TestCase):
    def example(self):
        return {'schema':'wil-rbs.partial-compute.v1', 'method':'source_operator_hooks',
                'scope':'partial_projection_only','run_id':'fusion001-family',
                'source_ref':'https://github.com/FPC-effortless/Woyengi/issues/67',
                'projection_macs_per_input_unit':1186944,'input_unit':'character',
                'forward_only':True,'unaccounted_categories':['attention','backward','optimizer']}
    def test_mac_double_accounting_never_full_train(self):
        x=audit_partial(self.example())
        self.assertEqual(x['forward_projection_flops_per_input_unit'],2373888)
        self.assertIsNone(x['training_flops'])
        self.assertFalse(x['end_to_end_training_flops_eligible'])
    def test_false_full_coverage_rejected(self):
        x=self.example();x['scope']='end_to_end_training'
        with self.assertRaises(ContractError):audit_partial(x)
    def test_missing_backward_disclosure_rejected(self):
        x=self.example();x['unaccounted_categories']=['attention','optimizer']
        with self.assertRaises(ContractError):audit_partial(x)

if __name__=='__main__':unittest.main()


class PairedExplorationTests(unittest.TestCase):
    def fixture(self):
        # Fictitious matched fixture tests software contracts, not model skill.
        p,r=source_fixture();tac=import_langdepth106(p,r)
        source,audit=upstream_fixture();transform=import_langbase107(source,audit)
        t_runs={x['seed']:x for x in tac['records'] if x['kind']=='run' and x['arm_id']=='tac106-four'}
        for row in transform['records']:
            if row['kind']!='run':continue
            a=t_runs[row['seed']]['data']; d=row['data']
            for k in ('dataset_sha256','train_split_sha256','sample_order_sha256','target_unit','context_length','train_exposure_units'):
                d[k]=a[k]
            row['resources']['wall_seconds']=100
        for row in transform['records']:
            if row['kind']=='evaluation':row['metric']['target_count']=100
        return tac,transform

    def test_source_matched_posthoc_report_never_qualifies(self):
        tac,transform=self.fixture()
        output=paired_language(tac,transform)
        self.assertEqual(output['status'],'POST_HOC_PAIRED_EXPLORATORY')
        self.assertEqual(len(output['paired_runs']),3)
        self.assertTrue(output['matched_per_seed_training_sample_order'])
        self.assertFalse(output['scientific_superiority_authorized'])
        self.assertFalse(output['training_flops_equal_or_verified'])

    def test_unmatched_sample_order_disallowed(self):
        tac,transform=self.fixture()
        run=next(x for x in transform['records'] if x['kind']=='run')
        run['data']['sample_order_sha256']='e'*64
        with self.assertRaises(ContractError):paired_language(tac,transform)

    def test_missing_source_time_disallowed(self):
        tac,transform=self.fixture()
        run=next(x for x in transform['records'] if x['kind']=='run')
        run['resources']['wall_seconds']=None
        with self.assertRaises(ContractError):paired_language(tac,transform)
