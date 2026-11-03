"""Contract/falsifier fixtures; synthetic test records are never capability results."""
from __future__ import annotations
import copy
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from wil_rbs import ContractError, validate
from wil_rbs_ingest import import_langdepth106
from wil_rbs_frontier import frontier

H=lambda ch:ch*64

def source_fixture():
    fit={'steps':4096,'batch_size':8,'sequence_length':128,'optimizer':'AdamW',
         'total_predicted_training_bytes_per_fit':4194304,'save_checkpoints_at':[0,4096]}
    source={'canonical_sha256':H('a'),'splits':{'TRAIN':{'sha256':H('b')},
            'DEV':{'bytes':101,'sha256':H('c')},'TEST':{'bytes':101,'sha256':H('d')}}}
    models={'four':{'parameters':998024,'config':{'depth':4}},
            'eight':{'parameters':999784,'config':{'depth':8}}}
    protocol={'study_id':'LANGDEPTH106','independent_attestation':False,'fit':fit,
              'source':source,'models':models,'seeds':[10601,10602,10603],
              'implementation':{'source_commit':'0'*40}}
    results={'study_id':'LANGDEPTH106','independent_attestation':False,
             'all_six_final_checkpoint_audit':'PASS','source_sha256':H('a'),
             'protocol_sha256':H('e'), 'runs':[]}
    diffs=[]
    for arm in ('four','eight'):
        for seed in protocol['seeds']:
            nll=1.6+(seed-10601)*0.01+(0.1 if arm=='eight' else 0)
            offset=H(str(7+seed-10601))
            cp=H('1' if arm=='four' else '2')
            cps=[{'step':0,'file':'step-0.pt','sha256':H('3')},
                 {'step':4096,'file':'step-4096.pt','sha256':cp}]
            r={'actual_steps':4096,'checkpoint_sha256':cp,'parameter_count':models[arm]['parameters'],
               'sample_offset_sha256':offset,'training_byte_presentations':4194304,
               'train_sha256':H('b'),'full_training_flops':'NOT_MEASURED',
               'independently_qualified':False,'checkpoints':cps,
               'config':models[arm]['config'],'source_receipt_sha256':H('5'),
               'implementation_sha256':H('6'),'python_version':'3.12',
               'torch_version':'2.15','cpu_threads':2,'hardware':'CPU',
               'process_cpu_seconds':12,'peak_rss_bytes':1000,'wall_seconds':110 if arm=='four' else 120}
            score={'target_count':100,'next_byte_nll_nats':nll,'next_byte_accuracy':0.5}
            results['runs'].append({'arm':arm,'seed':seed,'training_receipt':r,
                                   'checkpoint_integrity':{'actual_steps':4096,'checkpoint_sha256':cp,
                                                           'parameter_count':models[arm]['parameters'],
                                                           'sample_offset_sha256':offset},
                                   'cpu_inference_resource_fixture':{'persistent_logical_tensor_bytes':123},
                                   'metrics':{'test':{'reset_windows':score,'continuous_carry':score},
                                              'dev':{'reset_windows':score,'continuous_carry':score}}})
    results['paired_summary']={'test/reset_windows':{'mean_nll_eight_minus_four':0.1}}
    return protocol,results


class IngestionTests(unittest.TestCase):
    def test_source_import_six_runs_checkpoints_and_evals(self):
        p,r=source_fixture()
        m=import_langdepth106(p,r)
        self.assertEqual(validate(m)['counts'],{'run':6,'checkpoint':12,'evaluation':48,'historical_aggregate':0})
        self.assertEqual({x['evidence']['level'] for x in m['records']},{'reported'})
        self.assertTrue(all(x['resources']['training_flops']['value'] is None for x in m['records'] if x['kind']=='run'))
        self.assertTrue(all(x['metric']['target_sha256'] is None for x in m['records'] if x['kind']=='evaluation'))

    def test_bad_receipt_rejected(self):
        p,r=source_fixture()
        r['runs'][0]['training_receipt']['sample_offset_sha256']=H('e')
        with self.assertRaises(ContractError): import_langdepth106(p,r)

    def test_synthetic_claim_of_flops_rejected_until_adapter_review(self):
        p,r=source_fixture()
        r['runs'][0]['training_receipt']['full_training_flops']=12345
        with self.assertRaises(ContractError): import_langdepth106(p,r)

    def test_duplicate_source_fit_rejected(self):
        p,r=source_fixture()
        r['runs'][-1]=copy.deepcopy(r['runs'][0])
        with self.assertRaises(ContractError): import_langdepth106(p,r)

    def test_orphan_and_final_checkpoint_falsifier(self):
        p,r=source_fixture(); m=import_langdepth106(p,r)
        cp=next(x for x in m['records'] if x['kind']=='checkpoint' and x['step']==4096)
        cp['checkpoint_sha256']=H('9')
        with self.assertRaises(ContractError): validate(m)
        m=import_langdepth106(p,r)
        cp=next(x for x in m['records'] if x['kind']=='checkpoint')
        cp['run_id']='not-a-real-run'
        with self.assertRaises(ContractError): validate(m)

    def test_frontier_source_descriptive_and_flops_unknown(self):
        p,r=source_fixture(); m=import_langdepth106(p,r)
        out=frontier(m,study='LANGDEPTH106',cost='training_wall_seconds')
        self.assertEqual(out['status'],'EXPLORATORY_ONLY')
        self.assertFalse(out['target_and_evaluator_hashes_present'])
        by_arm={x['arm_id']:x for x in out['arms']}
        self.assertTrue(by_arm['tac106-four']['descriptive_pareto'])
        self.assertEqual(by_arm['tac106-eight']['dominated_by'],['tac106-four'])
        flops=frontier(m,study='LANGDEPTH106',cost='training_flops')
        self.assertFalse(flops['complete_cost_measurements'])
        self.assertTrue(all(x['descriptive_pareto'] is None for x in flops['arms']))

    def test_inconsistent_evaluator_units_rejected(self):
        p,r=source_fixture(); m=import_langdepth106(p,r)
        for x in m['records']:
            if x['kind']=='evaluation' and x['id'].endswith('test-reset_windows-nll') and x['run_id']=='langdepth106-eight-seed10601':
                x['metric']['unit']='nat/token'
        with self.assertRaises(ContractError): frontier(m,study='LANGDEPTH106')

    def test_repeated_seed_disallowed_in_frontier(self):
        p,r=source_fixture(); m=import_langdepth106(p,r)
        ev=next(x for x in m['records'] if x['kind']=='evaluation' and x['id'].endswith('test-reset_windows-nll'))
        extra=copy.deepcopy(ev);extra['id']='duplicate-seed-nll'; m['records'].append(extra)
        with self.assertRaises(ContractError): frontier(m,study='LANGDEPTH106')


if __name__=='__main__': unittest.main()
